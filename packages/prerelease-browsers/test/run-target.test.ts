import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readResults } from '../src/node/results.ts';
import { runTarget } from '../src/node/run-targets.ts';
import { findTarget } from '../src/node/targets.ts';
import type { PageDriver } from '../src/node/drivers/types.ts';
import { launchPlaywright } from '../src/node/drivers/playwright.ts';

let tmp: string;
const future = new Date(Date.now() + 60 * 60 * 1000);

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'prerelease-results-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test('past the deadline every check is not-run and the result is incomplete', async () => {
  const r = await runTarget(findTarget('local-chromium'), {
    resultsDir: tmp,
    deadline: new Date(0),
    rrwebCommit: 'abc',
  });
  expect(r.incomplete).toBe(true);
  expect(Object.keys(r.checks).length).toBeGreaterThan(0);
  expect(Object.values(r.checks).every((c) => c.status === 'not-run')).toBe(
    true,
  );
});

test('a launch failure is recorded, not thrown', async () => {
  const broken = {
    ...findTarget('local-chromium'),
    connect: () => Promise.reject(new Error('no binary')),
  };
  const r = await runTarget(broken, {
    resultsDir: tmp,
    deadline: future,
    rrwebCommit: 'abc',
  });
  expect(r.launch).toEqual({
    ok: false,
    error: expect.stringContaining('no binary'),
  });
  expect(r.checks).toEqual({});
  expect(await readResults(tmp)).toHaveLength(1);
});

test('only runs the selected check', async () => {
  const r = await runTarget(findTarget('local-chromium'), {
    resultsDir: tmp,
    deadline: future,
    rrwebCommit: 'abc',
    only: ['snapshot-basic'],
  });
  expect(Object.keys(r.checks)).toEqual(['snapshot-basic']);
  expect(r.checks['snapshot-basic'].status).toBe('pass');
  expect(r.launch).toEqual({ ok: true });
  expect(r.browser?.browserName).toBe('chromium');
  expect(r.incomplete).toBe(false);
  expect(await readResults(tmp)).toEqual([r]);
});

test('an unknown check id is rejected', async () => {
  await expect(
    runTarget(findTarget('local-chromium'), {
      resultsDir: tmp,
      deadline: future,
      rrwebCommit: 'abc',
      only: ['nope'],
    }),
  ).rejects.toThrow(/nope/);
});

test('a throwing driver fails that attempt, closes the driver and records a session', async () => {
  const real = await launchPlaywright({ engine: 'chromium' });
  let closed = false;
  const marks: Array<[boolean, string]> = [];
  const driver: PageDriver = {
    canReachLocalhost: true,
    loadHtml: () => Promise.reject(new Error('browser crashed')),
    open: () => real.open('about:blank'),
    evaluate: (expr) => real.evaluate(expr),
    describe: () => real.describe(),
    sessionUrl: async () => 'https://sessions.example/1',
    markSession: async (passed, reason) => {
      marks.push([passed, reason]);
    },
    close: async () => {
      closed = true;
      await real.close();
    },
  };
  const r = await runTarget(
    { ...findTarget('local-chromium'), connect: async () => driver },
    {
      resultsDir: tmp,
      deadline: future,
      rrwebCommit: 'abc',
      only: ['snapshot-basic'],
    },
  );
  expect(r.checks['snapshot-basic']).toMatchObject({
    status: 'fail',
    attempts: 2,
    message: expect.stringContaining('browser crashed'),
  });
  expect(closed).toBe(true);
  expect(r.sessionUrl).toBe('https://sessions.example/1');
  expect(marks).toHaveLength(1);
  expect(marks[0][0]).toBe(false);
});

test('events of the last failing attempt are written under the results dir', async () => {
  const real = await launchPlaywright({ engine: 'chromium' });
  // Flips the result after the check recorded, so the failing attempt carries events.
  const wrapped: PageDriver = {
    ...real,
    evaluate: async <T>(expr: string) => {
      const out = await real.evaluate<T>(expr);
      if (expr.startsWith('__prerelease.read(') && typeof out === 'string') {
        const parsed = JSON.parse(out);
        return JSON.stringify({ ...parsed, ok: false, message: 'forced' }) as T;
      }
      return out;
    },
    close: () => real.close(),
  };
  const r = await runTarget(
    { ...findTarget('local-chromium'), connect: async () => wrapped },
    {
      resultsDir: tmp,
      deadline: future,
      rrwebCommit: 'abc',
      only: ['snapshot-basic'],
    },
  );
  const outcome = r.checks['snapshot-basic'];
  expect(outcome.status).toBe('fail');
  expect(outcome.message).toBe('forced');
  expect(outcome.eventsFile).toBe('local-chromium/snapshot-basic.events.json');
  const events = JSON.parse(
    await readFile(join(tmp, outcome.eventsFile!), 'utf8'),
  );
  expect(events.some((e: { type: number }) => e.type === 2)).toBe(true);
});
