import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readResults } from '../src/node/results.ts';
import { runTarget } from '../src/node/run-targets.ts';
import { findTarget } from '../src/node/targets.ts';
import type { PageDriver } from '../src/node/drivers/types.ts';
import { launchPlaywright } from '../src/node/drivers/playwright.ts';
import { scriptedDriver } from './fake-driver.ts';

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

test('a deadline passing during an attempt stops its retries and the run', async () => {
  const deadline = new Date(future);
  const driver = scriptedDriver(
    () => ({ ok: false, message: 'bad' }),
    () => deadline.setTime(0),
  );
  const r = await runTarget(
    { ...findTarget('local-chromium'), connect: async () => driver },
    {
      resultsDir: tmp,
      deadline,
      rrwebCommit: 'abc',
      only: ['snapshot-basic', 'shadow-dom-open'],
    },
  );
  expect(driver.loads).toBe(1);
  expect(r.checks['snapshot-basic']).toEqual({
    kind: 'functional',
    status: 'not-run',
    attempts: 1,
    message: 'bad',
  });
  expect(r.checks['shadow-dom-open']).toMatchObject({
    status: 'not-run',
    attempts: 0,
  });
  expect(r.incomplete).toBe(true);
});

test('performance scenarios take perfSamples samples and leave the run complete', async () => {
  const target = { ...findTarget('local-chromium'), perfSamples: 4 };
  const driver = scriptedDriver((n) => ({
    ok: true,
    sample: { durationMs: n, maxBlockMs: n },
  }));
  const r = await runTarget(
    { ...target, connect: async () => driver },
    {
      resultsDir: tmp,
      deadline: future,
      rrwebCommit: 'abc',
      only: ['snapshot-basic', 'perf-snapshot-5k', 'perf-mutation-burst-10k'],
    },
  );
  expect(r.incomplete).toBe(false);
  expect(r.checks['perf-snapshot-5k']).toMatchObject({
    kind: 'performance',
    status: 'pass',
    attempts: 4,
    compare: ['durationMs'],
  });
  expect(r.checks['perf-snapshot-5k'].samples).toHaveLength(4);
  expect(r.checks['perf-mutation-burst-10k'].compare).toEqual([
    'durationMs',
    'maxBlockMs',
  ]);
  expect(await readResults(tmp)).toEqual([r]);
});

test('a deadline passing mid-scenario stops sampling and marks the run incomplete', async () => {
  const deadline = new Date(future);
  const driver = scriptedDriver(
    (n) => ({ ok: true, sample: { durationMs: n, maxBlockMs: n } }),
    (n) => {
      if (n === 2) deadline.setTime(0);
    },
  );
  const r = await runTarget(
    { ...findTarget('local-chromium'), connect: async () => driver },
    {
      resultsDir: tmp,
      deadline,
      rrwebCommit: 'abc',
      only: ['perf-snapshot-5k'],
    },
  );
  expect(driver.loads).toBe(2);
  expect(r.checks['perf-snapshot-5k']).toMatchObject({
    status: 'not-run',
    attempts: 2,
    samples: [
      { durationMs: 1, maxBlockMs: 1 },
      { durationMs: 2, maxBlockMs: 2 },
    ],
  });
  expect(r.incomplete).toBe(true);
});
