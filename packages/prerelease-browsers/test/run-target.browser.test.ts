// Tests that launch a real browser; `yarn test:browser` runs them. The
// browser-free tests of runTarget are in run-target.test.ts.
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PageDriver } from '../src/node/drivers/types.ts';
import { launchPlaywright } from '../src/node/drivers/playwright.ts';
import { readResults } from '../src/node/results.ts';
import { runTarget } from '../src/node/run-targets.ts';
import { findTarget } from '../src/node/targets.ts';

let tmp: string;
const future = new Date(Date.now() + 60 * 60 * 1000);

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'prerelease-results-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
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

describe('run-target command line', () => {
  const cli = fileURLToPath(new URL('../src/node/cli.ts', import.meta.url));
  const runCli = (...args: string[]) =>
    spawnSync(process.execPath, [cli, 'run-target', ...args], {
      encoding: 'utf8',
    });

  test('a crash after launch still writes a results file', async () => {
    const out = runCli(
      '--target',
      'local-chromium',
      '--check',
      'snapshot-basic',
      '--results',
      tmp,
      '--rrweb-dist',
      join(tmp, 'no-such-dist'),
      '--rrweb-commit',
      'abc',
    );
    expect(out.stderr).toBe('');
    expect(out.status).toBe(0);
    expect(out.stdout).toContain(
      'local-chromium launch failed: crashed: rrweb is not built',
    );
    const [r] = await readResults(tmp);
    expect(r).toMatchObject({
      targetId: 'local-chromium',
      rrwebCommit: 'abc',
      launch: { ok: false, error: expect.stringMatching(/^crashed: /) },
    });
  }, 60_000);
});
