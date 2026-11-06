import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readResults } from '../src/node/results.ts';
import { runTarget } from '../src/node/run-targets.ts';
import {
  applyPortOffset,
  findTarget,
  githubTargets,
  localTargets,
} from '../src/node/targets.ts';
import { findFenixNightlyApk } from '../src/node/install.ts';
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
