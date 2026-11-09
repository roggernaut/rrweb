import { evaluatePerf, median, perfId } from '../src/report/compare.ts';
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
      limit: 'ratio',
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

describe('a scenario with its own ceiling', () => {
  /** perf-snapshot-50k blocking `blocksMs`, its outcome carrying `ceilingMs`. */
  const big = (blocksMs: number[], ceilingMs: number, targetCeiling = 1000) => {
    const r = perfBlock('firefox-stable', 'compare', blocksMs, {
      checkId: 'perf-snapshot-50k',
      ceilingMs: targetCeiling,
    });
    r.checks['perf-snapshot-50k'].ceilingMs = ceilingMs;
    return r;
  };

  test('is held to that ceiling instead of the target one', () => {
    // firefox-stable blocked about 1081 ms on the first scheduled run.
    expect(evaluatePerf([big([1081, 1100, 1050], 3000)])).toEqual([]);
    expect(evaluatePerf([big([3100, 3200, 3000], 3000)])).toEqual([
      {
        targetId: 'firefox-stable',
        checkId: 'perf-snapshot-50k',
        limit: 'ceiling',
        message: 'longest block 3100 ms over 3000 ms ceiling',
      },
    ]);
  });

  test('never gets a lower ceiling than its target', () => {
    expect(evaluatePerf([big([3500, 3500, 3500], 3000, 4000)])).toEqual([]);
  });

  test('leaves the other scenarios on the target ceiling', () => {
    const r = big([1081, 1081, 1081], 3000);
    r.checks['perf-snapshot-5k'] = {
      kind: 'performance',
      status: 'pass',
      attempts: 1,
      samples: [{ durationMs: 100, maxBlockMs: 1081 }],
    };
    expect(evaluatePerf([r]).map((f) => [f.checkId, f.message])).toEqual([
      ['perf-snapshot-5k', 'longest block 1081 ms over 1000 ms ceiling'],
    ]);
  });
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

describe('a BrowserStack pair compares duration only (R76)', () => {
  /** perf-mutation-burst-10k: equal durations, the block 2.08x apart, all three metrics compared. */
  const pair = (where: 'browserstack' | 'github-linux', prefix: string) => {
    const mk = (id: string, channel: 'upcoming' | 'stable', block: number) => {
      const r = perf(id, channel, [100, 100, 100], {
        checkId: 'perf-mutation-burst-10k',
        pairGroup: 'chrome-android',
        where,
        compare: ['durationMs', 'maxBlockMs', 'heapDeltaBytes'],
      });
      r.checks['perf-mutation-burst-10k'].samples = [100, 100, 100].map(
        (durationMs) => ({
          durationMs,
          maxBlockMs: block,
          heapDeltaBytes: block * 100_000,
        }),
      );
      return r;
    };
    return [
      mk(`${prefix}-beta`, 'upcoming', 322),
      mk(`${prefix}-stable`, 'stable', 155),
    ];
  };

  test('maxBlockMs 2.08x with equal durations gives no finding', () => {
    expect(evaluatePerf(pair('browserstack', 'bs-android-chrome'))).toEqual([]);
  });

  test('the same numbers on a GitHub-runner pair still give findings', () => {
    expect(
      evaluatePerf(pair('github-linux', 'android-chrome')).map(
        (f) => f.message,
      ),
    ).toEqual([
      expect.stringMatching(/^maxBlockMs 322 vs stable 155 \(2\.08x\)$/),
      expect.stringMatching(/^heapDeltaBytes \d+ vs stable \d+ \(2\.08x\)$/),
    ]);
  });

  test('duration is still compared between BrowserStack targets', () => {
    const [up, st] = pair('browserstack', 'bs-android-chrome');
    up.checks['perf-mutation-burst-10k'].samples = [200, 200, 200].map(
      (durationMs) => ({ durationMs, maxBlockMs: 155 }),
    );
    expect(evaluatePerf([up, st]).map((f) => f.message)).toEqual([
      'durationMs 200 vs stable 100 (2.00x)',
    ]);
  });

  test('a maxBlockMs-only compare list leaves BrowserStack to the ceiling', () => {
    const [up, st] = pair('browserstack', 'bs-android-chrome');
    for (const r of [up, st]) {
      r.checks['perf-mutation-burst-10k'].compare = ['maxBlockMs'];
    }
    expect(evaluatePerf([up, st])).toEqual([]); // 322 vs 155 ms: 2.08x, not compared
    up.checks['perf-mutation-burst-10k'].samples = [100, 100, 100].map(
      (durationMs) => ({ durationMs, maxBlockMs: 1200 }),
    );
    expect(evaluatePerf([up, st]).map((f) => f.message)).toEqual([
      'longest block 1200 ms over 1000 ms ceiling',
    ]);
  });

  test('a BrowserStack target over the block ceiling is still flagged', () => {
    const [up, st] = pair('browserstack', 'bs-android-chrome');
    up.checks['perf-mutation-burst-10k'].samples = [100, 100, 100].map(
      (durationMs) => ({ durationMs, maxBlockMs: 1200 }),
    );
    expect(evaluatePerf([up, st]).map((f) => f.message)).toEqual([
      'longest block 1200 ms over 1000 ms ceiling',
    ]);
  });
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

describe('a limit that could not be measured', () => {
  const up = () => perf('chrome-canary', 'upcoming', [500, 500]);
  const unmeasuredBy = (...rs: Parameters<typeof evaluatePerf>[0]) => {
    const notes: string[] = [];
    const unmeasured = new Set<string>();
    evaluatePerf(rs, notes, unmeasured);
    return { notes, unmeasured: [...unmeasured] };
  };
  const id = perfId('chrome-canary', 'perf-snapshot-5k');

  test('no stable result leaves the check unmeasured', () => {
    expect(unmeasuredBy(up()).unmeasured).toEqual([id]);
  });
  test('a stable run cut short by the deadline is not compared', () => {
    const st = perf('chrome-stable', 'stable', [100]);
    st.checks['perf-snapshot-5k'].status = 'not-run';
    const { notes, unmeasured } = unmeasuredBy(up(), st);
    expect(unmeasured).toEqual([id]);
    expect(notes[0]).toContain('cut short');
  });
  test('a metric on only one side leaves the check unmeasured', () => {
    const u = perf('chrome-canary', 'upcoming', [100], {
      compare: ['heapDeltaBytes'],
    });
    u.checks['perf-snapshot-5k'].samples![0].heapDeltaBytes = 1;
    const st = perf('chrome-stable', 'stable', [100]);
    expect(unmeasuredBy(u, st).unmeasured).toEqual([id]);
  });
  test('a metric neither side has is simply not compared', () => {
    const u = perf('chrome-canary', 'upcoming', [100], {
      compare: ['heapDeltaBytes'],
    });
    const st = perf('chrome-stable', 'stable', [100]);
    expect(unmeasuredBy(u, st)).toEqual({ notes: [], unmeasured: [] });
  });
  test('no longest block leaves the ceiling unchecked', () => {
    const u = perf('chrome-canary', 'upcoming', [100]);
    u.checks['perf-snapshot-5k'].samples = [
      { durationMs: 100, maxBlockMs: Number.NaN },
    ];
    const st = perf('chrome-stable', 'stable', [100]);
    const { notes, unmeasured } = unmeasuredBy(u, st);
    expect(unmeasured).toEqual([id]);
    expect(notes[0]).toContain('no longest block');
  });
  test('a fully measured pair leaves nothing unmeasured', () => {
    const st = perf('chrome-stable', 'stable', [400, 400]);
    expect(unmeasuredBy(up(), st)).toEqual({ notes: [], unmeasured: [] });
  });
});

describe('exact boundaries', () => {
  const at = (u: number, s: number) =>
    evaluatePerf([
      perf('chrome-canary', 'upcoming', [u]),
      perf('chrome-stable', 'stable', [s]),
    ]);
  test('exactly the ratio limit is not a slowdown', () => {
    expect(at(300, 200)).toEqual([]);
  });
  test('just over the ratio limit is', () => {
    expect(at(301, 200)).toHaveLength(1);
  });
  test('exactly the ceiling is not a breach, just over it is', () => {
    expect(evaluatePerf([perfBlock('a', 'ceiling-only', [1000])])).toEqual([]);
    expect(evaluatePerf([perfBlock('a', 'ceiling-only', [1001])])).toHaveLength(
      1,
    );
  });
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
