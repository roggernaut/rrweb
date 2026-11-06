import { evaluatePerf, median } from '../src/report/compare.ts';
import { perf, perfBlock } from './helpers/results.ts';

test('median of odd and even lengths', () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 3, 2])).toBe(2.5);
});

test('upcoming 1.6x slower than stable by more than 50 ms fails', () => {
  expect(
    evaluatePerf([
      perf('chrome-canary', 'upcoming', [160, 170, 165]),
      perf('chrome-stable', 'stable', [100, 105, 102]),
    ]),
  ).toEqual([
    {
      targetId: 'chrome-canary',
      checkId: 'perf-snapshot-5k',
      message: expect.stringMatching(
        /^durationMs 165 vs stable 102 \(1\.6\dx\)$/,
      ),
    },
  ]);
});

test('a big ratio on tiny numbers does not fail', () => {
  expect(
    evaluatePerf([
      perf('chrome-canary', 'upcoming', [9, 9, 9]),
      perf('chrome-stable', 'stable', [3, 3, 3]),
    ]),
  ).toEqual([]);
});

test('a big difference below the ratio limit does not fail', () => {
  expect(
    evaluatePerf([
      perf('chrome-canary', 'upcoming', [1400, 1400, 1400]),
      perf('chrome-stable', 'stable', [1000, 1000, 1000]),
    ]),
  ).toEqual([]);
});

test('ceiling applies to stable targets and unpaired ones too', () => {
  expect(
    evaluatePerf([
      perfBlock('bs-samsung-internet', 'ceiling-only', [1200, 1300, 900]),
    ]).map((f) => f.message),
  ).toEqual(['longest block 1200 ms over 1000 ms ceiling']);
  expect(
    evaluatePerf([perfBlock('chrome-stable', 'compare', [1500, 1500, 1500])]),
  ).toHaveLength(1);
});

test('the ceiling uses each result own ceilingMs', () => {
  expect(
    evaluatePerf([
      perfBlock('bs-ipad', 'ceiling-only', [1200, 1200, 1200], {
        ceilingMs: 2000,
      }),
    ]),
  ).toEqual([]);
});

test('perf none targets are not measured', () => {
  const r = perfBlock('chrome-canary', 'compare', [5000, 5000, 5000]);
  r.perf = 'none';
  expect(evaluatePerf([r])).toEqual([]);
});

test('ceiling-only upcoming targets are not compared with stable', () => {
  const up = perf('chrome-canary', 'upcoming', [500, 500, 500]);
  up.perf = 'ceiling-only';
  expect(
    evaluatePerf([up, perf('chrome-stable', 'stable', [100, 100, 100])]),
  ).toEqual([]);
});

test('the compare list from the check selects the metrics', () => {
  const up = perf('chrome-canary', 'upcoming', [100, 100, 100], {
    compare: ['maxBlockMs'],
  });
  up.checks['perf-snapshot-5k'].samples = [
    { durationMs: 500, maxBlockMs: 200 },
    { durationMs: 500, maxBlockMs: 200 },
  ];
  const st = perf('chrome-stable', 'stable', [100, 100, 100]);
  st.checks['perf-snapshot-5k'].samples = [{ durationMs: 100, maxBlockMs: 50 }];
  expect(evaluatePerf([up, st]).map((f) => f.message)).toEqual([
    'maxBlockMs 200 vs stable 50 (4.00x)',
  ]);
});

test('heap needs more than 5 MB and is skipped when a side lacks it', () => {
  const heap = (mb: number) => ({
    durationMs: 100,
    maxBlockMs: 10,
    heapDeltaBytes: mb * 1024 * 1024,
  });
  const mk = (id: string, ch: 'upcoming' | 'stable', mbs: number[]) => {
    const r = perf(id, ch, [100], { compare: ['heapDeltaBytes'] });
    r.checks['perf-snapshot-5k'].samples = mbs.map(heap);
    return r;
  };
  expect(
    evaluatePerf([
      mk('chrome-canary', 'upcoming', [20, 20, 20]),
      mk('chrome-stable', 'stable', [10, 10, 10]),
    ]).map((f) => f.message),
  ).toEqual([
    `heapDeltaBytes ${20 * 1048576} vs stable ${10 * 1048576} (2.00x)`,
  ]);
  expect(
    evaluatePerf([
      mk('chrome-canary', 'upcoming', [6, 6, 6]),
      mk('chrome-stable', 'stable', [1, 1, 1]),
    ]),
  ).toEqual([]);
  const noHeap = perf('chrome-stable', 'stable', [100], {
    compare: ['heapDeltaBytes'],
  });
  expect(
    evaluatePerf([mk('chrome-canary', 'upcoming', [60, 60]), noHeap]),
  ).toEqual([]);
});

test('a missing stable result skips the comparison and says so', () => {
  const notes: string[] = [];
  expect(
    evaluatePerf([perf('chrome-canary', 'upcoming', [500, 500, 500])], notes),
  ).toEqual([]);
  expect(notes).toEqual([expect.stringContaining('chrome-canary')]);
});

test('a stable result without samples skips the comparison and says so', () => {
  const st = perf('chrome-stable', 'stable', [100]);
  delete st.checks['perf-snapshot-5k'].samples;
  const notes: string[] = [];
  expect(
    evaluatePerf([perf('chrome-canary', 'upcoming', [500, 500]), st], notes),
  ).toEqual([]);
  expect(notes).toEqual([expect.stringContaining('chrome-stable')]);
});
