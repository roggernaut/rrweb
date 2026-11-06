import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectFailures,
  parseKnownFailures,
  type KnownFailure,
} from '../src/report/failures.ts';
import { readResults, writeResult } from '../src/node/results.ts';
import {
  failing,
  ids,
  incomplete,
  launchFailed,
  passing,
  perf,
  perfBlock,
} from './helpers/results.ts';

test('a launch failure is not a check failure', () => {
  const s = collectFailures(
    [launchFailed('chrome-canary', 'crashed')],
    ['chrome-canary'],
    [],
  );
  expect(s.failures).toEqual([]);
  expect(s.launchFailures).toEqual([
    { targetId: 'chrome-canary', error: 'crashed' },
  ]);
  expect(s.incompleteTargets).toEqual([]);
  expect(s.missingTargets).toEqual([]);
  expect(s.totalKeys).toBe(0);
});

test('missing and incomplete targets are reported', () => {
  const s = collectFailures(
    [incomplete('edge-dev')],
    ['edge-dev', 'safari-tp'],
    [],
  );
  expect(s.missingTargets).toEqual(['safari-tp']);
  expect(s.incompleteTargets).toEqual(['edge-dev']);
  expect(s.failures).toEqual([]);
  expect(s.passedOn).toEqual({});
  expect(s.totalKeys).toBe(0);
});

test('a check that failed on an incomplete target still counts', () => {
  const r = incomplete('edge-dev');
  r.checks['css-nested-rules'] = {
    kind: 'functional',
    status: 'fail',
    attempts: 3,
    message: 'broke',
  };
  const s = collectFailures([r], ['edge-dev'], []);
  expect(s.incompleteTargets).toEqual(['edge-dev']);
  expect(s.failures.map((f) => f.key)).toEqual(['css-nested-rules:functional']);
});

test('same check failing on two targets is one failure', () => {
  const s = collectFailures(
    [
      failing('chrome-canary', 'css-nested-rules'),
      failing('chrome-stable', 'css-nested-rules'),
    ],
    ['chrome-canary', 'chrome-stable'],
    [],
  );
  expect(s.failures).toHaveLength(1);
  expect(s.failures[0]).toMatchObject({
    key: 'css-nested-rules:functional',
    checkId: 'css-nested-rules',
    kind: 'functional',
    engines: ['chromium'],
    alsoFailsOnStable: true,
  });
  expect(s.failures[0].targets).toHaveLength(2);
});

test('a failure carries the target details and a reproduce command', () => {
  const r = failing('chrome-canary', 'css-nested-rules');
  r.sessionUrl = 'https://bs.example/1';
  r.checks['css-nested-rules'].eventsFile = 'chrome-canary/x.events.json';
  const s = collectFailures([r], ['chrome-canary'], []);
  expect(s.failures[0].alsoFailsOnStable).toBe(false);
  expect(s.failures[0].targets).toEqual([
    {
      targetId: 'chrome-canary',
      engine: 'chromium',
      channel: 'upcoming',
      message: 'css-nested-rules broke',
      eventsFile: 'chrome-canary/x.events.json',
      sessionUrl: 'https://bs.example/1',
      reproduce:
        'yarn workspace @rrweb/prerelease-browsers run-target --target chrome-canary --check css-nested-rules',
    },
  ]);
});

test('passing, flaky and totalKeys', () => {
  const stable = passing('chrome-stable', 'a-check');
  Object.assign(stable.checks, passing('x', 'c-check').checks);
  const canary = passing('chrome-canary', 'a-check');
  canary.checks['a-check'].status = 'flaky';
  canary.checks['b-check'] = {
    kind: 'functional',
    status: 'skipped',
    attempts: 1,
  };
  const s = collectFailures(
    [stable, canary],
    ['chrome-stable', 'chrome-canary'],
    [],
  );
  expect(s.flaky).toEqual([
    { key: 'a-check:functional', targetId: 'chrome-canary' },
  ]);
  expect(s.passedOn).toEqual({
    'a-check:functional': ['chrome-stable'],
    'c-check:functional': ['chrome-stable'],
  });
  expect(s.totalKeys).toBe(2);
  expect(s.failures).toEqual([]);
});

test('parking covers only the listed engines, and expiry un-parks', () => {
  const entry = {
    key: 'css-nested-rules:functional',
    engines: ['webkit'],
    upstream: 'https://bugs.webkit.org/1',
    expires: '2026-12-01',
  };
  const rs = [
    failing('safari-tp', 'css-nested-rules'),
    failing('chrome-canary', 'css-nested-rules'),
  ];
  const active = collectFailures(
    rs,
    ids(rs),
    parseKnownFailures([entry], new Date('2026-11-06')).active,
  );
  expect(active.failures[0].targets.map((t) => t.targetId)).toEqual([
    'chrome-canary',
  ]);
  expect(active.parked).toHaveLength(1);
  expect(active.parked[0].failure.targets.map((t) => t.targetId)).toEqual([
    'safari-tp',
  ]);
  expect(active.parked[0].failure.engines).toEqual(['webkit']);
  expect(active.parked[0].entry.upstream).toBe('https://bugs.webkit.org/1');
  const expired = parseKnownFailures([entry], new Date('2026-12-02'));
  expect(expired.active).toEqual([]);
  expect(expired.expired).toHaveLength(1);
  const after = collectFailures(rs, ids(rs), expired.active);
  expect(after.failures[0].targets).toHaveLength(2);
  expect(after.parked).toEqual([]);
});

test('a failure whose targets are all parked moves entirely to parked', () => {
  const rs = [failing('safari-tp', 'css-nested-rules')];
  const s = collectFailures(
    rs,
    ids(rs),
    parseKnownFailures(
      [
        {
          key: 'css-nested-rules:functional',
          upstream: 'https://bugs.webkit.org/1',
          expires: '2026-12-01',
        },
      ],
      new Date('2026-11-06'),
    ).active,
  );
  expect(s.failures).toEqual([]);
  expect(s.parked).toHaveLength(1);
  expect(s.parked[0].failure.key).toBe('css-nested-rules:functional');
});

test('an entry for a different key parks nothing', () => {
  const rs = [failing('safari-tp', 'css-nested-rules')];
  const known: KnownFailure[] = [
    {
      key: 'css-nested-rules:privacy',
      upstream: 'https://x.example/1',
      expires: '2027-01-01',
    },
  ];
  const s = collectFailures(rs, ids(rs), known);
  expect(s.failures).toHaveLength(1);
  expect(s.parked).toEqual([]);
});

describe('performance', () => {
  test('a flagged pass becomes a performance failure', () => {
    const rs = [
      perf('chrome-canary', 'upcoming', [160, 170, 165]),
      perf('chrome-stable', 'stable', [100, 105, 102]),
    ];
    const s = collectFailures(rs, ids(rs), []);
    expect(s.failures).toHaveLength(1);
    expect(s.failures[0]).toMatchObject({
      key: 'perf-snapshot-5k:performance',
      kind: 'performance',
      engines: ['chromium'],
      alsoFailsOnStable: false,
    });
    expect(s.failures[0].targets[0].message).toMatch(
      /^durationMs 165 vs stable 102/,
    );
    expect(s.passedOn).toEqual({
      'perf-snapshot-5k:performance': ['chrome-stable'],
    });
    expect(s.totalKeys).toBe(1);
  });

  test('a pass carrying a message is not a failure', () => {
    const rs = [perf('chrome-stable', 'stable', [100, 100, 100])];
    rs[0].checks['perf-snapshot-5k'].message = 'one sample errored';
    const s = collectFailures(rs, ids(rs), []);
    expect(s.failures).toEqual([]);
    expect(s.passedOn['perf-snapshot-5k:performance']).toEqual([
      'chrome-stable',
    ]);
  });

  test('status fail is a performance failure with its message', () => {
    const r = perf('chrome-canary', 'upcoming', [100]);
    r.checks['perf-snapshot-5k'].status = 'fail';
    r.checks['perf-snapshot-5k'].message = 'timed out';
    const s = collectFailures([r], ['chrome-canary'], []);
    expect(s.failures[0].kind).toBe('performance');
    expect(s.failures[0].targets[0].message).toBe('timed out');
  });

  test('the ceiling failure shows up on a ceiling-only target', () => {
    const rs = [perfBlock('bs-samsung-internet', 'ceiling-only', [1500, 1500])];
    const s = collectFailures(rs, ids(rs), []);
    expect(s.failures[0].targets[0].message).toBe(
      'longest block 1500 ms over 1000 ms ceiling',
    );
  });

  test('evaluatePerf notes reach the summary', () => {
    const rs = [perf('chrome-canary', 'upcoming', [500, 500, 500])];
    expect(collectFailures(rs, ids(rs), []).notes).toEqual([
      expect.stringContaining('chrome-canary'),
    ]);
  });
});

describe('parseKnownFailures', () => {
  const ok = {
    key: 'a:functional',
    upstream: 'https://x.example/1',
    expires: '2027-01-01',
  };
  const now = new Date('2026-11-06');
  test('known-failures with an http link is rejected', () => {
    expect(() =>
      parseKnownFailures(
        [{ key: 'a:functional', upstream: 'http://x', expires: '2027-01-01' }],
        new Date(),
      ),
    ).toThrow();
  });
  test('bad key, bad date, bad shape and bad engine throw', () => {
    expect(() =>
      parseKnownFailures([{ ...ok, key: 'a:other' }], now),
    ).toThrow();
    expect(() =>
      parseKnownFailures([{ ...ok, key: 'A:functional' }], now),
    ).toThrow();
    expect(() =>
      parseKnownFailures([{ ...ok, expires: 'soon' }], now),
    ).toThrow();
    expect(() => parseKnownFailures({}, now)).toThrow();
    expect(() => parseKnownFailures([ok, 3], now)).toThrow();
    expect(() =>
      parseKnownFailures([{ ...ok, engines: ['ie'] }], now),
    ).toThrow();
    expect(() =>
      parseKnownFailures([{ ...ok, upstream: 'nonsense' }], now),
    ).toThrow();
  });
  test('the shipped known-failures.json parses', async () => {
    const file = fileURLToPath(
      new URL('../known-failures.json', import.meta.url),
    );
    const { readFile } = await import('node:fs/promises');
    expect(
      parseKnownFailures(JSON.parse(await readFile(file, 'utf8')), now),
    ).toEqual({
      active: [],
      expired: [],
    });
  });
});

describe('readResults', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'prerelease-failures-'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmp, { recursive: true, force: true });
  });

  test('a missing directory reads as no results', async () => {
    expect(await readResults(join(tmp, 'nope'))).toEqual([]);
  });

  test('unparsable and wrong-schema files are skipped with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeResult(tmp, passing('chrome-stable', 'a-check'));
    await writeFile(join(tmp, 'broken.json'), '{ nope');
    await writeFile(join(tmp, 'old.json'), JSON.stringify({ schema: 2 }));
    const rs = await readResults(tmp);
    expect(ids(rs)).toEqual(['chrome-stable']);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /broken\.json[\s\S]*old\.json/,
    );
    // The skipped target then shows up as missing.
    const s = collectFailures(rs, ['chrome-stable', 'broken'], []);
    expect(s.missingTargets).toEqual(['broken']);
  });

  test('a schema 1 file without a launch or checks object is skipped too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { launch: _launch, ...noLaunch } = passing('chrome-dev', 'a-check');
    const { checks: _checks, ...noChecks } = passing('edge-dev', 'a-check');
    await writeResult(tmp, passing('chrome-stable', 'a-check'));
    await writeFile(join(tmp, 'chrome-dev.json'), JSON.stringify(noLaunch));
    await writeFile(join(tmp, 'edge-dev.json'), JSON.stringify(noChecks));
    await writeFile(
      join(tmp, 'firefox-nightly.json'),
      JSON.stringify({ ...passing('firefox-nightly', 'a-check'), checks: [] }),
    );
    const rs = await readResults(tmp);
    expect(ids(rs)).toEqual(['chrome-stable']);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /chrome-dev\.json[\s\S]*edge-dev\.json[\s\S]*firefox-nightly\.json/,
    );
  });
});

describe('fixtures', () => {
  test('exactly one failing functional check, on chrome-canary', async () => {
    const dir = fileURLToPath(new URL('./fixtures/results', import.meta.url));
    const rs = await readResults(dir);
    expect(ids(rs)).toEqual(['chrome-canary', 'chrome-stable']);
    const s = collectFailures(rs, ids(rs), []);
    expect(s.failures).toHaveLength(1);
    expect(s.failures[0]).toMatchObject({
      kind: 'functional',
      alsoFailsOnStable: false,
    });
    expect(s.failures[0].targets.map((t) => t.targetId)).toEqual([
      'chrome-canary',
    ]);
    expect(s.missingTargets).toEqual([]);
  });
});
