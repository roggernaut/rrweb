import { runWithRetry } from '../src/node/run-check.ts';
import type { AttemptResult } from '../src/types.ts';

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
