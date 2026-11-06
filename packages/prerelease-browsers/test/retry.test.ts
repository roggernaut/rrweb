import { runScenario, runWithRetry } from '../src/node/run-check.ts';
import type { AttemptResult, CheckMeta } from '../src/types.ts';
import { scriptedDriver } from './fake-driver.ts';

const seq = (...results: AttemptResult[]) => {
  let i = 0;
  return async () => results[i++];
};
const ok = { ok: true };
const bad = { ok: false, message: 'bad' };

test.each([
  [[true], 'pass', 1],
  [[false, false], 'fail', 2],
  [[false, true, false], 'fail', 3],
  [[false, true, true], 'flaky', 3],
] as const)('%j gives %s after %i attempts', async (oks, status, n) => {
  const r = await runWithRetry(seq(...oks.map((v) => (v ? ok : bad))));
  expect(r.status).toBe(status);
  expect(r.attempts).toHaveLength(n);
});

test('a skipped first attempt is final', async () => {
  const r = await runWithRetry(seq({ ok: true, skipped: 'needs http' }));
  expect(r.status).toBe('skipped');
  expect(r.attempts).toHaveLength(1);
});

test('no attempt starts after the deadline', async () => {
  const r = await runWithRetry(seq(ok), new Date(0));
  expect(r).toEqual({ status: 'not-run', attempts: [] });
});

test('a deadline passing during an attempt stops the retries', async () => {
  const deadline = new Date(Date.now() + 60_000);
  const r = await runWithRetry(async () => {
    deadline.setTime(0);
    return bad;
  }, deadline);
  expect(r).toEqual({ status: 'not-run', attempts: [bad] });
});

describe('runScenario', () => {
  const meta: CheckMeta = {
    id: 'perf-test',
    kind: 'performance',
    tier: 'focused',
  };
  const src = { bundle: '', rrweb: '' };
  const sample = (n: number) => ({ durationMs: n, maxBlockMs: n / 2 });
  const okSample = (n: number): AttemptResult => ({
    ok: true,
    sample: sample(n),
  });

  test('takes every sample from a fresh page and passes', async () => {
    const driver = scriptedDriver(okSample);
    const r = await runScenario(driver, meta, src, {
      samples: 3,
      timeoutMs: 1000,
    });
    expect(driver.loads).toBe(3);
    expect(r).toEqual({
      kind: 'performance',
      status: 'pass',
      attempts: 3,
      samples: [sample(1), sample(2), sample(3)],
      compare: ['durationMs'],
    });
  });

  test('copies compare from the scenario', async () => {
    const r = await runScenario(
      scriptedDriver(okSample),
      { ...meta, compare: ['durationMs', 'maxBlockMs'] },
      src,
      { samples: 1, timeoutMs: 1000 },
    );
    expect(r.compare).toEqual(['durationMs', 'maxBlockMs']);
  });

  test('one error still passes with the other samples', async () => {
    const r = await runScenario(
      scriptedDriver((n) =>
        n === 2 ? { ok: false, message: 'boom' } : okSample(n),
      ),
      meta,
      src,
      { samples: 3, timeoutMs: 1000 },
    );
    expect(r).toMatchObject({
      status: 'pass',
      attempts: 3,
      samples: [sample(1), sample(3)],
      message: 'boom',
    });
  });

  test('two errors fail the scenario with the error message', async () => {
    const driver = scriptedDriver((n) =>
      n === 1 ? okSample(n) : { ok: false, message: `boom ${n}` },
    );
    const r = await runScenario(driver, meta, src, {
      samples: 5,
      timeoutMs: 1000,
    });
    expect(driver.loads).toBe(3);
    expect(r).toMatchObject({
      status: 'fail',
      attempts: 3,
      samples: [sample(1)],
      message: 'boom 3',
    });
  });

  test('a single sample that errors fails', async () => {
    const r = await runScenario(
      scriptedDriver(() => ({ ok: false, message: 'boom' })),
      meta,
      src,
      { samples: 1, timeoutMs: 1000 },
    );
    expect(r).toMatchObject({ status: 'fail', message: 'boom' });
  });

  test('a result without a sample counts as an error', async () => {
    const r = await runScenario(
      scriptedDriver(() => ok),
      meta,
      src,
      {
        samples: 2,
        timeoutMs: 1000,
      },
    );
    expect(r).toMatchObject({
      status: 'fail',
      message: 'scenario returned no sample',
    });
  });

  test('a skipped first sample skips the scenario', async () => {
    const driver = scriptedDriver(okSample);
    const r = await runScenario(
      { ...driver, canReachLocalhost: false },
      { ...meta, needsHttp: true },
      src,
      { samples: 3, timeoutMs: 1000 },
    );
    expect(r).toMatchObject({
      status: 'skipped',
      message: 'needs http',
      attempts: 1,
    });
  });

  test('a deadline passing mid-scenario stops sampling and keeps the samples', async () => {
    const deadline = new Date(Date.now() + 60_000);
    const driver = scriptedDriver(okSample, (n) => {
      if (n === 2) deadline.setTime(0);
    });
    const r = await runScenario(driver, meta, src, {
      samples: 5,
      timeoutMs: 1000,
      deadline,
    });
    expect(driver.loads).toBe(2);
    expect(r).toEqual({
      kind: 'performance',
      status: 'not-run',
      attempts: 2,
      samples: [sample(1), sample(2)],
      compare: ['durationMs'],
    });
  });
});
