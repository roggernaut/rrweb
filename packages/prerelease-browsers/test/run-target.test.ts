import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readResults } from '../src/node/results.ts';
import { collectFailures } from '../src/report/failures.ts';
import { RealmReuseError } from '../src/node/drivers/selenium.ts';
import { DeadlineReached } from '../src/node/run-check.ts';
import { runTarget, runTargetOrRecordCrash } from '../src/node/run-targets.ts';
import {
  applyPortOffset,
  asPrRole,
  findTarget,
  githubTargets,
  localTargets,
} from '../src/node/targets.ts';
import { findFenixNightlyApk } from '../src/node/install.ts';
import type { AttemptResult } from '../src/types.ts';
import { scriptedDriver } from './fake-driver.ts';

let tmp: string;
const future = new Date(Date.now() + 60 * 60 * 1000);

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'prerelease-results-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test('past the deadline every check is not-run and no session opens', async () => {
  let connects = 0;
  const r = await runTarget(
    {
      ...findTarget('local-chromium'),
      connect: async () => {
        connects++;
        return scriptedDriver(() => ({ ok: true }));
      },
    },
    { resultsDir: tmp, deadline: new Date(0), rrwebCommit: 'abc' },
  );
  expect(connects).toBe(0);
  expect(r.launch).toEqual({ ok: true });
  expect(r.incomplete).toBe(true);
  expect(r.incompleteReason).toBe('deadline');
  expect(Object.keys(r.checks).length).toBeGreaterThan(0);
  expect(Object.values(r.checks).every((c) => c.status === 'not-run')).toBe(
    true,
  );
  expect(await readResults(tmp)).toEqual([r]);
});

test('a connect cut off by the deadline is incomplete, not a launch failure', async () => {
  const r = await runTarget(
    {
      ...findTarget('local-chromium'),
      connect: () =>
        Promise.reject(
          new DeadlineReached('BROWSERSTACK_ALL_PARALLELS_IN_USE'),
        ),
    },
    {
      resultsDir: tmp,
      deadline: future,
      rrwebCommit: 'abc',
      only: ['snapshot-basic', 'shadow-dom-open'],
    },
  );
  expect(r.launch).toEqual({ ok: true });
  expect(r.incomplete).toBe(true);
  expect(r.incompleteReason).toBe('deadline');
  expect(r.checks).toEqual({
    'snapshot-basic': { kind: 'functional', status: 'not-run', attempts: 0 },
    'shadow-dom-open': { kind: 'functional', status: 'not-run', attempts: 0 },
  });
});

/** A scripted driver whose poll() answers garbage on the loads `broken` picks. */
function brokenPollDriver(broken: (load: number) => boolean) {
  const driver = scriptedDriver(() => ({ ok: true }));
  const inner = driver.evaluate;
  driver.evaluate = async <T>(expression: string): Promise<T> =>
    expression === '__prerelease.poll()' && broken(driver.loads)
      ? ([null, null] as T)
      : inner<T>(expression);
  return driver;
}

test('two checks in a row with a broken protocol stop the target and blame neither', async () => {
  let closed = false;
  const marks: Array<[boolean, string]> = [];
  const driver = brokenPollDriver(() => true);
  driver.close = async () => void (closed = true);
  driver.markSession = async (passed, reason) =>
    void marks.push([passed, reason]);
  const r = await runTarget(
    { ...findTarget('local-chromium'), connect: async () => driver },
    {
      resultsDir: tmp,
      deadline: future,
      rrwebCommit: 'abc',
      only: ['snapshot-basic', 'shadow-dom-open', 'iframe-same-origin'],
    },
  );
  expect(driver.loads).toBe(4);
  // The checks that tripped the breaker keep what they took, for the status
  // issue, but are not failures: the driver broke, not rrweb.
  expect(r.checks).toEqual({
    'snapshot-basic': {
      kind: 'functional',
      status: 'not-run',
      attempts: 2,
      message: 'malformed poll result from driver',
    },
    'shadow-dom-open': {
      kind: 'functional',
      status: 'not-run',
      attempts: 2,
      message: 'malformed poll result from driver',
    },
    'iframe-same-origin': {
      kind: 'functional',
      status: 'not-run',
      attempts: 0,
    },
  });
  expect(r.incomplete).toBe(true);
  expect(r.incompleteReason).toBe('protocol broken');
  expect(closed).toBe(true);
  expect(marks).toEqual([[false, 'incomplete: protocol broken']]);
  expect(collectFailures([r], [r.targetId], []).failures).toEqual([]);
});

test('two checks in a row that time out stop the target and blame neither', async () => {
  // Every poll says running, so each attempt runs into its timeout.
  const driver = scriptedDriver(() => ({ ok: true }));
  const inner = driver.evaluate;
  driver.evaluate = async <T>(expression: string): Promise<T> =>
    expression === '__prerelease.poll()'
      ? ({ state: 'running' } as T)
      : inner<T>(expression);
  const r = await runTarget(
    {
      ...findTarget('local-chromium'),
      // 60 ms attempts instead of 60 s.
      timeScale: 0.001,
      connect: async () => driver,
    },
    {
      resultsDir: tmp,
      deadline: future,
      rrwebCommit: 'abc',
      only: ['snapshot-basic', 'shadow-dom-open', 'iframe-same-origin'],
    },
  );
  expect(Object.values(r.checks)).toEqual([
    {
      kind: 'functional',
      status: 'not-run',
      attempts: 2,
      message: 'timed out after 60 ms',
    },
    {
      kind: 'functional',
      status: 'not-run',
      attempts: 2,
      message: 'timed out after 60 ms',
    },
    { kind: 'functional', status: 'not-run', attempts: 0 },
  ]);
  expect(r.incomplete).toBe(true);
  expect(r.incompleteReason).toBe('protocol broken');
  expect(collectFailures([r], [r.targetId], []).failures).toEqual([]);
  expect(await readResults(tmp)).toEqual([r]);
});

describe('a driver that cannot give a page a fresh Window', () => {
  /** A scripted driver whose loads from `from` on throw RealmReuseError. */
  function realmReuseDriver(from: number) {
    const driver = scriptedDriver(() => ({ ok: true }));
    const inner = driver.loadHtml;
    let closed = false;
    driver.loadHtml = async (html) => {
      if (driver.loads + 1 >= from) {
        driver.loads++;
        throw new RealmReuseError('no fresh tab');
      }
      await inner(html);
    };
    driver.close = async () => void (closed = true);
    return Object.assign(driver, { closed: () => closed });
  }

  test('stops the target with every remaining check not-run', async () => {
    const driver = realmReuseDriver(2);
    const r = await runTarget(
      { ...findTarget('local-chromium'), connect: async () => driver },
      {
        resultsDir: tmp,
        deadline: future,
        rrwebCommit: 'abc',
        only: ['snapshot-basic', 'shadow-dom-open', 'iframe-same-origin'],
      },
    );
    expect(driver.loads).toBe(2);
    expect(r.checks).toEqual({
      'snapshot-basic': { kind: 'functional', status: 'pass', attempts: 1 },
      'shadow-dom-open': { kind: 'functional', status: 'not-run', attempts: 0 },
      'iframe-same-origin': {
        kind: 'functional',
        status: 'not-run',
        attempts: 0,
      },
    });
    expect(r.launch).toEqual({ ok: true });
    expect(r.incomplete).toBe(true);
    expect(r.incompleteReason).toBe('fresh window unavailable');
    expect(driver.closed()).toBe(true);
    expect(await readResults(tmp)).toEqual([r]);
  });

  test('stops a performance scenario the same way', async () => {
    const driver = realmReuseDriver(1);
    const r = await runTarget(
      { ...findTarget('local-chromium'), connect: async () => driver },
      {
        resultsDir: tmp,
        deadline: future,
        rrwebCommit: 'abc',
        only: ['perf-snapshot-5k', 'perf-mutation-burst-10k'],
      },
    );
    expect(Object.values(r.checks).map((c) => c.status)).toEqual([
      'not-run',
      'not-run',
    ]);
    expect(r.incompleteReason).toBe('fresh window unavailable');
    expect(driver.closed()).toBe(true);
  });
});

test('a working check between broken ones keeps the target going', async () => {
  // Loads 1-2: snapshot-basic broken; 3: shadow-dom-open passes; 4-5 broken.
  const driver = brokenPollDriver((n) => n !== 3);
  const r = await runTarget(
    { ...findTarget('local-chromium'), connect: async () => driver },
    {
      resultsDir: tmp,
      deadline: future,
      rrwebCommit: 'abc',
      only: ['snapshot-basic', 'shadow-dom-open', 'iframe-same-origin'],
    },
  );
  expect(driver.loads).toBe(5);
  // An isolated broken check trips nothing, so it stays a failure.
  expect(r.checks['snapshot-basic']).toMatchObject({
    status: 'fail',
    attempts: 2,
    message: 'malformed poll result from driver',
  });
  expect(r.checks['shadow-dom-open'].status).toBe('pass');
  expect(r.checks['iframe-same-origin'].status).toBe('fail');
  expect(r.incomplete).toBe(false);
  expect(r.incompleteReason).toBeUndefined();
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

test('a crash around the checks still leaves a results file', async () => {
  const started = new Date().toISOString();
  // An unknown check id makes runTarget itself throw.
  const r = await runTargetOrRecordCrash(findTarget('local-chromium'), {
    resultsDir: tmp,
    deadline: future,
    only: ['no-such-check'],
    rrwebCommit: 'abc',
  });
  expect(r.launch).toEqual({
    ok: false,
    error: expect.stringMatching(/^crashed: unknown check "no-such-check"/),
  });
  expect(r.startedAt >= started).toBe(true);
  expect(r.finishedAt >= r.startedAt).toBe(true);
  expect(await readResults(tmp)).toEqual([r]);
});

test('rrwebDist feeds both the composed pages and the fixture server', async () => {
  const dist = join(tmp, 'other-dist');
  await mkdir(dist);
  await writeFile(
    join(dist, 'rrweb.umd.cjs'),
    'var rrweb = {}; /* rrweb from rrwebDist */',
  );
  const pages: string[] = [];
  const driver = scriptedDriver(() => ({ ok: true }));
  const loadHtml = driver.loadHtml;
  const open = driver.open;
  driver.loadHtml = async (html) => {
    pages.push(html);
    await loadHtml(html);
  };
  driver.open = async (url) => {
    pages.push(await (await fetch(url)).text());
    await open(url);
  };
  const port = process.env.PRERELEASE_HTTP_PORT;
  process.env.PRERELEASE_HTTP_PORT = '0';
  try {
    const r = await runTarget(
      { ...findTarget('local-chromium'), connect: async () => driver },
      {
        resultsDir: tmp,
        deadline: future,
        rrwebCommit: 'abc',
        only: ['snapshot-basic', 'css-early-linked-stylesheet'],
        rrwebDist: dist,
      },
    );
    expect(Object.values(r.checks).map((c) => c.status)).toEqual([
      'pass',
      'pass',
    ]);
  } finally {
    if (port === undefined) delete process.env.PRERELEASE_HTTP_PORT;
    else process.env.PRERELEASE_HTTP_PORT = port;
  }
  // One page composed in memory, one served by the fixture server.
  expect(pages).toHaveLength(2);
  for (const page of pages) {
    expect(page).toContain('rrweb from rrwebDist');
  }
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

test('a scenario with its own ceiling carries the higher of it and the target one', async () => {
  const run = (ceilingMs?: number) =>
    runTarget(
      {
        ...findTarget('local-chromium'),
        perfSamples: 1,
        ceilingMs,
        connect: async () =>
          scriptedDriver(() => ({
            ok: true,
            sample: { durationMs: 1, maxBlockMs: 1 },
          })),
      },
      {
        resultsDir: tmp,
        deadline: future,
        rrwebCommit: 'abc',
        only: ['perf-snapshot-5k', 'perf-snapshot-50k'],
      },
    );
  const r = await run();
  expect(r.ceilingMs).toBe(1000);
  expect(r.checks['perf-snapshot-50k'].ceilingMs).toBe(3000);
  expect(r.checks['perf-snapshot-5k']).not.toHaveProperty('ceilingMs');
  expect((await run(5000)).checks['perf-snapshot-50k'].ceilingMs).toBe(5000);
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

describe('a privacy check whose public control went missing', () => {
  const missing: AttemptResult = {
    ok: false,
    kind: 'functional',
    message: 'public control missing: RRPUBLICX',
  };
  const leak: AttemptResult = { ok: false, message: 'privacy leak: RRCANARYX' };
  const run = (next: (n: number) => AttemptResult) =>
    runTarget(
      {
        ...findTarget('local-chromium'),
        connect: async () => scriptedDriver(next),
      },
      {
        resultsDir: tmp,
        deadline: future,
        rrwebCommit: 'abc',
        only: ['privacy-mask-all-inputs'],
      },
    );

  test('fails as a functional check', async () => {
    const r = await run(() => missing);
    expect(r.checks['privacy-mask-all-inputs']).toEqual({
      kind: 'functional',
      status: 'fail',
      attempts: 2,
      message: 'public control missing: RRPUBLICX',
    });
  });

  test('stays privacy when another failed attempt leaked', async () => {
    const r = await run((n) => (n === 1 ? leak : missing));
    expect(r.checks['privacy-mask-all-inputs']).toMatchObject({
      kind: 'privacy',
      status: 'fail',
    });
  });

  test('stays privacy when it passed after all', async () => {
    const r = await run((n) => (n === 1 ? missing : { ok: true }));
    expect(r.checks['privacy-mask-all-inputs']).toMatchObject({
      kind: 'privacy',
      status: 'flaky',
    });
  });
});

describe('GitHub-runner targets', () => {
  test('match the target table', () => {
    const none = undefined;
    // prettier-ignore
    const table = [
      ['chrome-canary',           'chromium', 'upcoming', 'chrome-linux',  'github-linux',   'all',                'compare'],
      ['chrome-dev',              'chromium', 'upcoming', 'chrome-linux',  'github-linux',   'all',                'compare'],
      ['chrome-stable',           'chromium', 'stable',   'chrome-linux',  'github-linux',   'all',                'compare'],
      ['edge-dev',                'chromium', 'upcoming', 'edge-linux',    'github-linux',   'all',                'compare'],
      ['edge-stable',             'chromium', 'stable',   'edge-linux',    'github-linux',   'all',                'compare'],
      ['firefox-nightly',         'gecko',    'upcoming', 'firefox-linux', 'github-linux',   'all',                'compare'],
      ['firefox-stable',          'gecko',    'stable',   'firefox-linux', 'github-linux',   'all',                'compare'],
      ['webkit-next',             'webkit',   'upcoming', none,            'github-linux',   'all',                'ceiling-only'],
      ['safari-tp',               'webkit',   'upcoming', 'safari-macos',  'github-macos',   'all',                'compare'],
      ['safari-stable',           'webkit',   'stable',   'safari-macos',  'github-macos',   'all',                'compare'],
      ['firefox-android-nightly', 'gecko',    'upcoming', none,            'github-android', 'functional-privacy', 'none'],
    ];
    expect(
      githubTargets.map((t) => [
        t.id,
        t.engine,
        t.channel,
        t.pairGroup,
        t.where,
        t.checks,
        t.perf,
      ]),
    ).toEqual(table);
    for (const t of githubTargets) {
      expect([t.id, t.timeScale, t.perfSamples]).toEqual([t.id, 1, 5]);
    }
  });

  test('every upcoming target in a pair group has exactly one stable target in that group', () => {
    const upcoming = githubTargets.filter(
      (t) => t.pairGroup && t.channel === 'upcoming',
    );
    expect(upcoming.length).toBeGreaterThan(0);
    for (const t of upcoming) {
      const stable = githubTargets.filter(
        (s) => s.pairGroup === t.pairGroup && s.channel === 'stable',
      );
      expect([t.id, stable.length]).toEqual([t.id, 1]);
    }
  });

  test('ids are unique across local and GitHub targets', () => {
    const ids = [...localTargets, ...githubTargets].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('asPrRole pairs the two builds for comparison', () => {
    const pr = asPrRole(findTarget('chrome-stable'), 'pr');
    const base = asPrRole(findTarget('chrome-stable'), 'base');
    expect([pr.id, pr.channel, base.id, base.channel]).toEqual([
      'chrome-stable@pr',
      'upcoming',
      'chrome-stable@base',
      'stable',
    ]);
    expect(pr.pairGroup).toBe(base.pairGroup);
    expect(pr.pairGroup).toBe('pr-chrome-stable');
    expect([pr.checks, pr.perf]).toEqual(['focused', 'compare']);
    expect([base.checks, base.perf]).toEqual(['focused', 'compare']);
    // The browser and its launch are the target's own.
    expect(pr.connect).toBe(findTarget('chrome-stable').connect);
    expect(findTarget('chrome-stable').id).toBe('chrome-stable');
  });

  test('findTarget finds GitHub targets', () => {
    expect(findTarget('safari-tp').where).toBe('github-macos');
  });

  test('a port offset moves the driver port by one and the fixture ports by two', () => {
    const env: Record<string, string | undefined> = {};
    applyPortOffset(1, env);
    expect(env).toEqual({
      PRERELEASE_PORT_OFFSET: '1',
      PRERELEASE_HTTP_PORT: '8125',
    });
    const free: Record<string, string | undefined> = {
      PRERELEASE_HTTP_PORT: '0',
    };
    applyPortOffset(2, free);
    expect(free.PRERELEASE_HTTP_PORT).toBe('0');
    expect(() => applyPortOffset(-1, {})).toThrow(/port offset/);
  });
});

describe('findFenixNightlyApk', () => {
  const fixtures = fileURLToPath(new URL('fixtures/fenix/', import.meta.url));
  const root = 'https://ftp.mozilla.org/pub/fenix/nightly';

  async function listings(byUrl: Record<string, string>) {
    const pages: Record<string, string> = {};
    for (const [url, file] of Object.entries(byUrl)) {
      pages[url] = await readFile(join(fixtures, file), 'utf8');
    }
    const requested: string[] = [];
    const fetchListing = async (url: string) => {
      requested.push(url);
      return pages[url];
    };
    return { requested, fetchListing };
  }

  test('falls back to the previous month and picks its newest x86_64 build', async () => {
    const build = `${root}/2026/10/2026-10-31-04-40-11-fenix-161.0a1-android-x86_64/`;
    const { fetchListing } = await listings({
      [`${root}/2026/11/`]: 'month-empty.html',
      [`${root}/2026/10/`]: 'month.html',
      [build]: 'build.html',
    });
    expect(
      await findFenixNightlyApk(new Date('2026-11-01T03:00:00Z'), fetchListing),
    ).toBe(`${build}fenix-161.0a1.multi.android-x86_64.apk`);
  });

  test('in January the previous month is December of the year before', async () => {
    const { requested, fetchListing } = await listings({});
    await expect(
      findFenixNightlyApk(new Date('2027-01-01T03:00:00Z'), fetchListing),
    ).rejects.toThrow(/no Fenix nightly/);
    expect(requested).toEqual([`${root}/2027/01/`, `${root}/2026/12/`]);
  });
});

describe('run-target command line', () => {
  const cli = fileURLToPath(new URL('../src/node/cli.ts', import.meta.url));
  const runCli = (...args: string[]) =>
    spawnSync(process.execPath, [cli, 'run-target', ...args], {
      encoding: 'utf8',
    });

  test('an unknown check exits before any session, with no results file', async () => {
    const out = runCli(
      '--target',
      'local-chromium',
      '--check',
      'nope',
      '--results',
      tmp,
    );
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('unknown check "nope"');
    expect(await readResults(tmp)).toEqual([]);
  });
});
