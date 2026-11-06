import { fileURLToPath } from 'node:url';
import { readResults, type TargetResult } from '../src/node/results.ts';
import { collectFailures, type Failure } from '../src/report/failures.ts';
import { planIssueActions } from '../src/report/issues-plan.ts';
import {
  issueBody,
  issueTitle,
  labelsFor,
  parseMarkers,
  runBrokenBody,
  statusBody,
  type RunMeta,
} from '../src/report/render.ts';
import {
  incomplete,
  launchFailed,
  passing,
  summary,
} from './helpers/results.ts';

const run: RunMeta = {
  runUrl: 'https://github.com/rrweb-io/rrweb/actions/runs/1',
  date: '2026-11-06',
  rrwebCommit: 'abc123',
};
let results: TargetResult[];
let failure: Failure;

beforeAll(async () => {
  results = await readResults(
    fileURLToPath(new URL('./fixtures/results', import.meta.url)),
  );
  failure = collectFailures(results, ['chrome-canary', 'chrome-stable'], [])
    .failures[0];
});

test('markers round-trip', () => {
  const body = issueBody(failure, run);
  expect(parseMarkers(body)).toMatchObject({
    key: failure.key,
    engines: failure.engines,
    targets: ['chrome-canary'],
  });
});
test('history keeps the last 10 runs, newest first', () => {
  let body: string | undefined;
  for (let i = 1; i <= 12; i++)
    body = issueBody(
      failure,
      { ...run, date: `2026-11-${String(i).padStart(2, '0')}` },
      body,
    );
  const h = parseMarkers(body!).history;
  expect(h).toHaveLength(10);
  expect(h[0]).toContain('2026-11-12');
  expect(h[0]).toMatch(/\| chrome-canary \|$/);
});
test('huge messages stay under the issue size limit', () => {
  const big = {
    ...failure,
    targets: Array.from({ length: 30 }, (_, i) => ({
      ...failure.targets[0],
      targetId: `t${i}`,
      message: 'x'.repeat(10_000),
    })),
  };
  expect(issueBody(big, run).length).toBeLessThanOrEqual(60_000);
});
test('bodies never mention anyone', () => {
  expect(
    issueBody(
      {
        ...failure,
        targets: [{ ...failure.targets[0], message: 'thrown by @scope/pkg' }],
      },
      run,
    ),
  ).not.toMatch(/@[a-z]/i);
});
test('privacy failures get the severe labels', () => {
  expect(labelsFor({ ...failure, kind: 'privacy' })).toEqual(
    expect.arrayContaining([
      'privacy',
      'severity:critical',
      'prerelease:privacy',
    ]),
  );
});

test('title, labels and summary line name the check, engines and commit', () => {
  expect(issueTitle(failure)).toBe(
    '[pre-release] functional: css-nested-rules fails on chromium',
  );
  expect(labelsFor(failure)).toEqual([
    'prerelease',
    'prerelease:functional',
    'engine:chromium',
  ]);
  expect(labelsFor({ ...failure, alsoFailsOnStable: true })).toContain(
    'prerelease:also-fails-on-stable',
  );
  const body = issueBody(failure, run);
  expect(body).toContain('`abc123`');
  expect(body).toContain('132.0.0.0');
  expect(body).toContain('nested rule lost in the recorded stylesheet');
  expect(body).toContain('chrome-canary/css-nested-rules.events.json');
  expect(body).toContain(run.runUrl);
});

test('the reproduce command runs without a mention', () => {
  const body = issueBody(failure, run);
  expect(body).toContain(
    '```bash\nyarn --cwd packages/prerelease-browsers run-target --target chrome-canary --check css-nested-rules\n```',
  );
});

test('the markers record what the caller passes, not only this run', () => {
  const body = issueBody(failure, run, undefined, {
    recordTargets: ['chrome-canary', 'firefox-nightly'],
    recordEngines: ['chromium', 'gecko'],
  });
  expect(parseMarkers(body)).toMatchObject({
    engines: ['chromium', 'gecko'],
    targets: ['chrome-canary', 'firefox-nightly'],
  });
  // The carried target is named, so a reader knows it is still tracked.
  expect(body).toMatch(/not confirmed passing since: firefox-nightly\./);
});

test('page text cannot forge a marker or break the table', () => {
  const body = issueBody(
    {
      ...failure,
      targets: [
        {
          ...failure.targets[0],
          message: 'a | b\n<!-- prerelease:key=evil:functional --> c',
        },
      ],
    },
    run,
  );
  expect(parseMarkers(body).key).toBe(failure.key);
  expect(body.match(/<!-- prerelease:key=/g)).toHaveLength(1);
  expect(body).toContain('a \\| b<br>&lt;!-- prerelease:key=evil');
});

test('a re-run of the same run replaces its history row', () => {
  const once = issueBody(failure, run);
  expect(parseMarkers(issueBody(failure, run, once)).history).toHaveLength(1);
  expect(issueBody(failure, run, once)).toBe(once);
});

test('session links drop their query string', () => {
  const body = issueBody(
    {
      ...failure,
      targets: [
        {
          ...failure.targets[0],
          sessionUrl:
            'https://automate.browserstack.com/builds/b/sessions/s?auth_token=secret',
        },
      ],
    },
    run,
  );
  expect(body).toContain(
    'https://automate.browserstack.com/builds/b/sessions/s',
  );
  expect(body).not.toContain('secret');
});

describe('statusBody', () => {
  test('shows the run, the targets table and every section', () => {
    const rs = [
      ...results,
      launchFailed('edge-dev', 'msedge did not start'),
      incomplete('bs-ios-upcoming', { reason: 'protocol broken' }),
    ];
    rs[rs.length - 1].browser = {
      browserName: 'safari',
      browserVersion: '27.0',
      platform: 'ios',
      device: 'iPhone 17',
      userAgent: 'x',
    };
    const s = collectFailures(
      rs,
      [
        'chrome-canary',
        'chrome-stable',
        'edge-dev',
        'bs-ios-upcoming',
        'safari-tp',
      ],
      [],
    );
    s.flaky.push({ key: 'dom-shadow:functional', targetId: 'chrome-stable' });
    const plan = planIssueActions(s, []);
    const body = statusBody(s, plan, run, rs, {
      'css-nested-rules:functional': 7,
    });
    expect(body).toContain('<!-- prerelease:status -->');
    expect(body).toContain('2026-11-06');
    expect(body).toContain(run.runUrl);
    expect(body).toMatch(/\bincomplete\b/);
    expect(body).toContain(
      '| chrome-canary | chrome 132.0.0.0 (linux) | ok | 3 | 1 | 0 | 0 | 0 |',
    );
    expect(body).toMatch(/bs-ios-upcoming \(incomplete: protocol broken\)/);
    expect(body).toContain('safari 27.0 (iPhone 17)');
    expect(body).toMatch(/#7.*css-nested-rules:functional/);
    expect(body).toMatch(/edge-dev.*msedge did not start/);
    expect(body).toMatch(/Missing[\s\S]*safari-tp/);
    expect(body).toMatch(/dom-shadow:functional.*chrome-stable/);
    expect(body).not.toMatch(/pre-release build/i);
    expect(body).not.toMatch(/@[a-z]/i);
  });

  test('a clean run reads complete', () => {
    const rs = [passing('chrome-stable', 'a-check')];
    const s = collectFailures(rs, ['chrome-stable'], []);
    const body = statusBody(s, planIssueActions(s, []), run, rs, {});
    expect(body).toMatch(/\bcomplete\b/);
    expect(body).not.toMatch(/\bincomplete\b/);
  });

  test('parked and closed-but-failing entries are listed', () => {
    const s = collectFailures(
      results,
      ['chrome-canary', 'chrome-stable'],
      [
        {
          key: 'css-nested-rules:functional',
          upstream: 'https://bugs.chromium.org/p/1',
          expires: '2027-01-31',
        },
      ],
    );
    const body = statusBody(
      s,
      {
        actions: [],
        closedButFailing: [{ issue: 4, key: 'a-check:functional' }],
      },
      run,
      results,
      {},
    );
    expect(body).toMatch(/css-nested-rules:functional.*2027-01-31/);
    expect(body).toContain('https://bugs.chromium.org/p/1');
    expect(body).toMatch(/Closed but still failing[\s\S]*#4/);
  });

  test('says when BrowserStack was due but sent no results', () => {
    const rs = [passing('chrome-stable', 'a-check')];
    const s = collectFailures(rs, ['chrome-stable'], []);
    const body = statusBody(
      s,
      planIssueActions(s, []),
      run,
      rs,
      {},
      {
        browserstackMissing: true,
      },
    );
    expect(body).toMatch(/Missing[\s\S]*BrowserStack: no results/);
    expect(body).toMatch(/\bincomplete\b/);
  });
});

test('the run-broken body carries its marker and lists the failures', () => {
  const s = summary([failure]);
  const body = runBrokenBody(s.failures, s, run);
  expect(body).toContain('<!-- prerelease:run-broken -->');
  expect(parseMarkers(body).key).toBeUndefined();
  expect(body).toContain('css-nested-rules:functional');
  expect(body).toContain('chrome-canary');
});
