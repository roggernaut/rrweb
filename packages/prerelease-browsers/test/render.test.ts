import { fileURLToPath } from 'node:url';
import { readResults, type TargetResult } from '../src/node/results.ts';
import { collectFailures, type Failure } from '../src/report/failures.ts';
import { LABEL_COLOURS } from '../src/report/github.ts';
import { planIssueActions } from '../src/report/issues-plan.ts';
import {
  issueBody,
  issueTitle,
  labelsFor,
  parseMarkers,
  runBrokenBody,
  runBrokenTitle,
  statusBody,
  statusTitle,
  type RunCount,
  type RunMeta,
} from '../src/report/render.ts';
import {
  countLine,
  fail,
  ids,
  incomplete,
  launchFailed,
  passing,
  summary,
} from './helpers/results.ts';

const run: RunMeta = {
  runUrl: 'https://github.com/rrweb-io/rrweb/actions/runs/1',
  runId: '1',
  date: '2026-11-06',
  rrwebCommit: 'abc123',
};
const one: RunCount = { failing: 1, heldBack: 0 };
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
  const body = issueBody(failure, run, one);
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
      one,
      body === undefined ? undefined : { body },
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
  expect(issueBody(big, run, one).length).toBeLessThanOrEqual(60_000);
});
test('bodies never mention anyone', () => {
  expect(
    issueBody(
      {
        ...failure,
        targets: [
          {
            ...failure.targets[0],
            message:
              'thrown by @scope/pkg, @1st1, @0xdevalias and @123org/team',
          },
        ],
      },
      run,
      one,
    ),
  ).not.toMatch(/@[a-z0-9]/i);
});
test('privacy failures carry the privacy label and no kind label', () => {
  const labels = labelsFor(fail('mask-check:privacy', ['chrome-canary']));
  expect(labels).toEqual(['prerelease', 'privacy', 'engine:chromium']);
  expect(labels).not.toContain('prerelease:privacy');
  expect(labels).not.toContain('severity:critical');
});

test('functional and performance failures keep their kind label', () => {
  expect(
    labelsFor(fail('css-nested-rules:functional', ['chrome-canary'])),
  ).toEqual(['prerelease', 'prerelease:functional', 'engine:chromium']);
  expect(labelsFor(fail('record-cost:performance', ['chrome-canary']))).toEqual(
    ['prerelease', 'prerelease:performance', 'engine:chromium'],
  );
});

test('no label says a stable browser fails too, and the body still does', () => {
  const both = fail('css-nested-rules:functional', [
    'chrome-canary',
    'chrome-stable',
  ]);
  expect(both.alsoFailsOnStable).toBe(true);
  expect(labelsFor(both)).not.toContain('prerelease:also-fails-on-stable');
  expect(issueBody(both, run, one)).toContain('fails on a stable browser too');
  expect(Object.keys(LABEL_COLOURS)).not.toContain('severity:critical');
  expect(Object.keys(LABEL_COLOURS)).not.toContain(
    'prerelease:also-fails-on-stable',
  );
  expect(Object.keys(LABEL_COLOURS)).not.toContain('prerelease:privacy');
});

test('a title is the check and the engines, without a prefix', () => {
  expect(
    issueTitle(
      fail('privacy-canvas-block:privacy', [
        'chrome-stable',
        'firefox-nightly',
        'safari-tp',
      ]),
    ),
  ).toBe('privacy-canvas-block fails on chromium, gecko, webkit');
});

test('a title notes when only upcoming builds fail', () => {
  expect(
    issueTitle(fail('privacy-canvas-block:privacy', ['chrome-canary'])),
  ).toBe('privacy-canvas-block fails on chromium (upcoming builds only)');
  expect(
    issueTitle(
      fail('privacy-canvas-block:privacy', [
        'chrome-canary',
        'firefox-nightly',
      ]),
    ),
  ).toBe(
    'privacy-canvas-block fails on chromium, gecko (upcoming builds only)',
  );
  // One stable target is enough to drop the note.
  expect(
    issueTitle(
      fail('privacy-canvas-block:privacy', ['chrome-canary', 'firefox-stable']),
    ),
  ).toBe('privacy-canvas-block fails on chromium, gecko');
});

test('a title drops the upcoming-only note when a carried target is kept', () => {
  const f = fail('privacy-canvas-block:privacy', ['chrome-canary']);
  expect(issueTitle(f, ['chrome-canary'])).toBe(
    'privacy-canvas-block fails on chromium (upcoming builds only)',
  );
  expect(issueTitle(f, ['chrome-canary', 'chrome-stable'])).toBe(
    'privacy-canvas-block fails on chromium',
  );
});

test('title, labels and summary line name the check, engines and commit', () => {
  expect(issueTitle(failure)).toBe(
    'css-nested-rules fails on chromium (upcoming builds only)',
  );
  expect(labelsFor(failure)).toEqual([
    'prerelease',
    'prerelease:functional',
    'engine:chromium',
  ]);
  const body = issueBody(failure, run, one);
  expect(body).toContain('`abc123`');
  expect(body).toContain('132.0.0.0');
  expect(body).toContain('nested rule lost in the recorded stylesheet');
  expect(body).toContain('chrome-canary/css-nested-rules.events.json');
  expect(body).toContain(run.runUrl);
});

test('the reproduce command runs without a mention', () => {
  const body = issueBody(failure, run, one);
  expect(body).toContain(
    '```bash\nyarn --cwd packages/prerelease-browsers run-target --target chrome-canary --check css-nested-rules\n```',
  );
});

test('a BrowserStack reproduce command runs without a mention', () => {
  const canary = results.find((r) => r.targetId === 'chrome-canary')!;
  const [bs] = collectFailures(
    [{ ...canary, targetId: 'bs-android-upcoming', where: 'browserstack' }],
    ['bs-android-upcoming'],
    [],
  ).failures;
  expect(issueBody(bs, run, one)).toContain(
    '```bash\nyarn --cwd packages/prerelease-browsers run-browserstack --only bs-android-upcoming --check css-nested-rules\n```',
  );
});

test('the markers record what the caller passes, not only this run', () => {
  const body = issueBody(failure, run, one, {
    record: {
      recordTargets: ['chrome-canary', 'firefox-nightly'],
      recordEngines: ['chromium', 'gecko'],
    },
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
    one,
  );
  expect(parseMarkers(body).key).toBe(failure.key);
  expect(body.match(/<!-- prerelease:key=/g)).toHaveLength(1);
  expect(body).toContain(
    '`a \\| b ⏎ < !-- prerelease:key=evil:functional --> c`',
  );
});

test('a re-run of the same run replaces its history row', () => {
  const once = issueBody(failure, run, one);
  const again = issueBody(failure, run, one, { body: once });
  expect(parseMarkers(again).history).toHaveLength(1);
  expect(again).toBe(once);
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
    one,
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
      launchFailed('edge-dev', 'msedge did not start for @1st1'),
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
      '| chrome-canary | `chrome 132.0.0.0 (linux)` | ok | 3 | 1 | 0 | 0 | 0 |',
    );
    expect(body).toMatch(/bs-ios-upcoming \(incomplete: `protocol broken`\)/);
    expect(body).toContain('`safari 27.0 (iPhone 17)`');
    expect(body).toMatch(/#7.*css-nested-rules:functional/);
    expect(body).toMatch(/edge-dev: `msedge did not start/);
    expect(body).toMatch(/Missing[\s\S]*safari-tp/);
    expect(body).toMatch(/dom-shadow:functional.*chrome-stable/);
    expect(body).not.toMatch(/pre-release build/i);
    expect(body).not.toMatch(/@[a-z0-9]/i);
  });

  test('lists the checks that tripped the breaker under their target', () => {
    const broken = incomplete('firefox-android-nightly', {
      reason: 'protocol broken',
    });
    broken.checks = {
      'css-shorthand-roundtrip': {
        kind: 'functional',
        status: 'not-run',
        attempts: 2,
        message: 'timed out after 120000 ms',
      },
      // Results files are read back untrusted.
      'css-selector-colon-escape': {
        kind: 'functional',
        status: 'not-run',
        attempts: 2,
        message: 'garbled `poll` from @driver | <!-- x',
      },
      'css-grid-template-areas': {
        kind: 'functional',
        status: 'not-run',
        attempts: 0,
      },
    };
    broken.trippedBy = ['css-shorthand-roundtrip', 'css-selector-colon-escape'];
    // A working driver on which rrweb hung: the tripping checks failed.
    const hang = incomplete('chrome-dev', { reason: 'rrweb hang' });
    hang.checks = {
      'snapshot-basic': {
        kind: 'functional',
        status: 'fail',
        attempts: 2,
        message: 'timed out after 60000 ms',
      },
      'shadow-dom-open': {
        kind: 'functional',
        status: 'fail',
        attempts: 2,
        message: 'timed out after 60000 ms',
      },
      'custom-elements': { kind: 'functional', status: 'not-run', attempts: 0 },
    };
    hang.trippedBy = ['snapshot-basic', 'shadow-dom-open'];
    // Cut off by the deadline mid-check: nothing tripped the breaker.
    const late = incomplete('chrome-canary', { reason: 'deadline' });
    late.checks['css-nested-rules'] = {
      kind: 'functional',
      status: 'not-run',
      attempts: 1,
      message: 'bad',
    };
    const rs = [broken, hang, late];
    const s = collectFailures(rs, ids(rs), []);
    const body = statusBody(s, planIssueActions(s, []), run, rs, {});
    const section = body.slice(body.indexOf('### Incomplete'));
    expect(section).toContain(
      [
        '- firefox-android-nightly: `protocol broken`, after',
        '  - css-shorthand-roundtrip (2 attempts): `timed out after 120000 ms`',
        "  - css-selector-colon-escape (2 attempts): `garbled 'poll' from ＠driver | < !-- x`",
      ].join('\n'),
    );
    expect(section).toContain(
      [
        '- chrome-dev: `rrweb hang`, after',
        '  - snapshot-basic (2 attempts): `timed out after 60000 ms`',
        '  - shadow-dom-open (2 attempts): `timed out after 60000 ms`',
      ].join('\n'),
    );
    expect(section).not.toContain('css-grid-template-areas');
    expect(section).not.toContain('custom-elements');
    expect(section).toContain('- chrome-canary: `deadline`\n');
    expect(section).not.toContain('css-nested-rules');
  });

  test('a run with a browser that did not launch reads incomplete', () => {
    const rs = [launchFailed('chrome-canary', 'no browser')];
    const s = collectFailures(rs, ['chrome-canary'], []);
    const body = statusBody(s, planIssueActions(s, []), run, rs, {});
    expect(body).toMatch(/\*\*incomplete\*\*/);
    expect(body).not.toMatch(/\*\*complete\*\*/);
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
        heldBack: [],
      },
      run,
      results,
      {},
    );
    expect(body).toMatch(/css-nested-rules:functional.*2027-01-31/);
    expect(body).toContain('https://bugs.chromium.org/p/1');
    expect(body).toMatch(/Closed but still failing[\s\S]*#4/);
  });

  test('names a target stopped for want of a fresh window', () => {
    const rs = [
      passing('chrome-stable', 'a-check'),
      incomplete('safari-tp', { reason: 'fresh window unavailable' }),
    ];
    const s = collectFailures(rs, ['chrome-stable', 'safari-tp'], []);
    const body = statusBody(s, planIssueActions(s, []), run, rs, {});
    expect(body).toMatch(/\bincomplete\b/);
    expect(body).toMatch(
      /safari-tp \(incomplete: `fresh window unavailable`\)/,
    );
    expect(body).toMatch(/- safari-tp: `fresh window unavailable`/);
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

describe('a partial run', () => {
  const rs = [passing('chrome-stable', 'a-check')];
  const s = collectFailures(rs, ['chrome-stable'], []);

  test('never reads complete, and lists what it left out', () => {
    const body = statusBody(
      s,
      planIssueActions(s, []),
      run,
      rs,
      {},
      { leftOut: ['safari-tp', 'browserstack'] },
    );
    expect(body).toContain('is a **partial run**');
    expect(body).not.toMatch(/\*\*complete\*\*/);
    expect(body).toMatch(
      /### Not covered by this run\n\n- safari-tp\n- BrowserStack\n/,
    );
  });

  test('that is also incomplete says both', () => {
    const body = statusBody(
      s,
      planIssueActions(s, []),
      run,
      rs,
      {},
      { leftOut: ['safari-tp'], browserstackMissing: true },
    );
    expect(body).toContain('is an **incomplete partial run**');
  });

  test('a full run has no left-out section', () => {
    const body = statusBody(s, planIssueActions(s, []), run, rs, {}, {});
    expect(body).toContain('is **complete**');
    expect(body).not.toContain('Not covered by this run');
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

/** The body with every inline code span removed: what renders as markdown. */
const outsideCode = (body: string) => body.replace(/`[^`\n]*`/g, '');

test('untrusted text renders as code, so links, images and references stay inert', () => {
  const message = '[x](https://e.com) ![i](https://e.com/i.png) a/b#1';
  const withMessage = {
    ...failure,
    targets: [{ ...failure.targets[0], message }],
  };
  const issue = issueBody(withMessage, run, one);
  expect(issue).toContain('`' + message + '`');
  const s = summary([withMessage], {
    launchFailures: [{ targetId: 'edge-dev', error: message }],
    notes: [message],
  });
  const status = statusBody(s, planIssueActions(s, []), run, results, {});
  const broken = runBrokenBody(s.failures, s, run);
  for (const body of [issue, status, broken]) {
    expect(outsideCode(body)).not.toContain('e.com');
    expect(outsideCode(body)).not.toContain('a/b#1');
  }
});

describe('a hard size cap on every body', () => {
  const heavy = '<&>|\n\n\n@1st1 `x`'.repeat(1_000);
  const heavyFailure = (n: number): Failure => ({
    ...failure,
    targets: Array.from({ length: n }, (_, i) => ({
      ...failure.targets[0],
      targetId: `t${i}`,
      message: heavy,
    })),
  });
  const checkCapped = (body: string) => {
    expect(body.length).toBeLessThanOrEqual(60_000);
    expect(body).not.toMatch(/@[a-z0-9]/i);
  };

  for (const n of [400]) {
    test(`issue body, ${n} targets`, () => {
      const body = issueBody(heavyFailure(n), run, one);
      checkCapped(body);
      expect(parseMarkers(body)).toMatchObject({
        key: failure.key,
        engines: ['chromium'],
        targets: Array.from({ length: n }, (_, i) => `t${i}`).sort(),
      });
      if (n === 400) {
        expect(body).toMatch(/\n_This body was truncated[^\n]*_\n$/);
        // An open code block is closed before the notice.
        expect((body.match(/^```/gm) ?? []).length % 2).toBe(0);
      }
    });

    test(`run-broken body, ${n} failures`, () => {
      const failures = Array.from({ length: n }, (_, i) => ({
        ...heavyFailure(40),
        key: `c${i}:functional`,
        checkId: `c${i}`,
      }));
      const body = runBrokenBody(failures, summary(failures), run);
      checkCapped(body);
      expect(body.startsWith('<!-- prerelease:run-broken -->')).toBe(true);
    });

    test(`status body, ${n} launch failures`, () => {
      const rs = Array.from({ length: n }, (_, i) =>
        launchFailed(`t${i}`, heavy),
      );
      const s = collectFailures(rs, [], []);
      s.notes.push(...Array.from({ length: n }, () => heavy));
      const body = statusBody(s, planIssueActions(s, []), run, rs, {});
      checkCapped(body);
      expect(body.startsWith('<!-- prerelease:status -->')).toBe(true);
    });
  }
});

const runN = (n: number): RunMeta => ({
  ...run,
  runUrl: `https://github.com/rrweb-io/rrweb/actions/runs/${n}`,
  runId: String(n),
});

describe("the run's failure count", () => {
  test.each<[RunCount, string]>([
    [{ failing: 1, heldBack: 0 }, '**This run found 1 failing check.**'],
    [{ failing: 4, heldBack: 0 }, '**This run found 4 failing checks.**'],
    [
      { failing: 4, heldBack: 2, cap: 2 },
      '**This run found 4 failing checks.** 2 were held back by the per-run cap of 2.',
    ],
    [
      { failing: 3, heldBack: 1, cap: 2 },
      '**This run found 3 failing checks.** 1 was held back by the per-run cap of 2.',
    ],
  ])('%o reads right after the markers', (count, line) => {
    expect(countLine(issueBody(failure, run, count))).toBe(line);
    const previous = issueBody(failure, runN(2), one);
    expect(countLine(issueBody(failure, run, count, { body: previous }))).toBe(
      line,
    );
    expect(
      countLine(
        issueBody(failure, run, count, { body: previous, reopened: true }),
      ),
    ).toBe(line);
  });

  test('the run-broken body counts every failure', () => {
    const s = summary([failure, fail('b:functional', ['chrome-canary'])]);
    expect(countLine(runBrokenBody(s.failures, s, run))).toBe(
      '**This run found 2 failing checks.**',
    );
  });

  test('the status body counts too, held back included', () => {
    const s = summary([
      fail('a:functional', ['chrome-canary']),
      fail('b:functional', ['chrome-canary', 'firefox-nightly']),
    ]);
    const body = statusBody(
      s,
      planIssueActions(s, [], undefined, 1),
      run,
      results,
      {},
      { issueCap: 1 },
    );
    expect(countLine(body)).toBe(
      '**This run found 2 failing checks.** 1 was held back by the per-run cap of 1.',
    );
  });
});

test('the notified marker names the run that last opened or reopened the issue', () => {
  const created = issueBody(failure, runN(1), one);
  expect(parseMarkers(created).notified).toBe(runN(1).runUrl);
  const updated = issueBody(failure, runN(2), one, { body: created });
  expect(parseMarkers(updated).notified).toBe(runN(1).runUrl);
  const reopened = issueBody(failure, runN(3), one, {
    body: updated,
    reopened: true,
  });
  expect(parseMarkers(reopened).notified).toBe(runN(3).runUrl);
});

test('a run without an id writes no notified marker of its own', () => {
  const local: RunMeta = { ...run, runId: undefined };
  expect(parseMarkers(issueBody(failure, local, one)).notified).toBeUndefined();
  const stamped = issueBody(failure, runN(1), one);
  expect(
    parseMarkers(
      issueBody(failure, local, one, { body: stamped, reopened: true }),
    ).notified,
  ).toBeUndefined();
});

describe('held-back failures in the status body', () => {
  const s = summary([
    fail('a:functional', ['chrome-canary']),
    fail('b:functional', ['chrome-canary', 'firefox-nightly']),
    fail('z:privacy', ['safari-tp']),
  ]);

  test('are listed under the cap with their engines and target count', () => {
    const body = statusBody(
      s,
      planIssueActions(s, [], undefined, 1),
      run,
      results,
      {},
      { issueCap: 1 },
    );
    expect(body).toContain(
      '### Held back by the per-run issue cap (1)\n\n' +
        '- `b:functional` on chromium, gecko, 2 targets\n' +
        '- `a:functional` on chromium, 1 target\n',
    );
    expect(body).toMatch(/### Open failures\n\n- new issue `z:privacy`/);
  });

  test('leave no section when nothing was held back', () => {
    const body = statusBody(s, planIssueActions(s, []), run, results, {});
    expect(body).not.toContain('Held back');
  });
});

test('the run-broken and status titles read plainly', () => {
  expect(
    runBrokenTitle([
      fail('a:functional', ['chrome-canary']),
      fail('b:functional', ['chrome-canary']),
    ]),
  ).toBe('Pre-release browsers: run broken, 2 checks failed');
  expect(statusTitle).toBe('Pre-release browsers: status of the latest run');
});
