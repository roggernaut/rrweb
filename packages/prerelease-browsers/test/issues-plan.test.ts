import {
  MASS_FAILURE_MIN,
  MASS_FAILURE_SHARE,
  planIssueActions,
} from '../src/report/issues-plan.ts';
import { fail, issue, summary } from './helpers/results.ts';

test('new failure creates; second run on the same results only updates', () => {
  const s = summary([fail('css-nested-rules:functional', ['chrome-canary'])]);
  expect(planIssueActions(s, []).actions.map((a) => a.type)).toEqual([
    'create',
  ]);
  const afterFirst = [
    issue(
      1,
      'open',
      'css-nested-rules:functional',
      ['chromium'],
      ['chrome-canary'],
    ),
  ];
  expect(planIssueActions(s, afterFirst).actions).toEqual([
    { type: 'update', issue: 1, failure: s.failures[0] },
  ]);
});
test('ten failing checks out of twenty collapse into one run-broken action', () => {
  const s = summary(
    Array.from({ length: 10 }, (_, i) =>
      fail(`c${i}:functional`, ['safari-tp']),
    ),
    { totalKeys: 20 },
  );
  expect(planIssueActions(s, []).actions).toEqual([
    { type: 'run-broken', failures: s.failures },
  ]);
});
test('closed by hand stays closed unless the failure spreads to a new engine', () => {
  const closed = [
    issue(4, 'closed', 'k:functional', ['webkit'], ['safari-tp']),
  ];
  expect(
    planIssueActions(summary([fail('k:functional', ['safari-tp'])]), closed),
  ).toEqual({
    actions: [],
    closedButFailing: [{ issue: 4, key: 'k:functional' }],
  });
  expect(
    planIssueActions(
      summary([fail('k:functional', ['safari-tp', 'chrome-canary'])]),
      closed,
    ).actions[0],
  ).toMatchObject({ type: 'reopen', issue: 4, reason: 'spread' });
});
test('auto-closed issue failing again reopens as regressed', () => {
  const closed = [
    issue(
      5,
      'closed',
      'k:privacy',
      ['gecko'],
      ['firefox-nightly'],
      ['prerelease:recovered'],
    ),
  ];
  expect(
    planIssueActions(summary([fail('k:privacy', ['firefox-nightly'])]), closed)
      .actions[0],
  ).toMatchObject({ type: 'reopen', reason: 'regressed' });
});
test('recovery closes only when every failing target ran and passed', () => {
  const open = [
    issue(
      6,
      'open',
      'k:functional',
      ['chromium', 'webkit'],
      ['chrome-canary', 'safari-tp'],
    ),
  ];
  expect(
    planIssueActions(
      summary([], {
        passedOn: { 'k:functional': ['chrome-canary'] },
        missingTargets: ['safari-tp'],
      }),
      open,
    ).actions,
  ).toEqual([]);
  expect(
    planIssueActions(
      summary([], {
        passedOn: { 'k:functional': ['chrome-canary', 'safari-tp'] },
      }),
      open,
    ).actions,
  ).toEqual([{ type: 'close', issue: 6, key: 'k:functional' }]);
});
test('a launch failure never closes an issue', () => {
  const open = [
    issue(7, 'open', 'k:functional', ['chromium'], ['chrome-canary']),
  ];
  expect(
    planIssueActions(
      summary([], {
        launchFailures: [{ targetId: 'chrome-canary', error: 'x' }],
      }),
      open,
    ).actions,
  ).toEqual([]);
});

describe('keeping issues open without evidence of recovery', () => {
  const open = [
    issue(
      8,
      'open',
      'k:functional',
      ['chromium', 'webkit'],
      ['chrome-canary', 'safari-tp'],
    ),
  ];
  test('an incomplete target that failed before keeps its issue open', () => {
    const s = summary([], {
      passedOn: { 'k:functional': ['chrome-canary'] },
      incompleteTargets: ['safari-tp'],
    });
    expect(planIssueActions(s, open).actions).toEqual([]);
  });
  test('a check that is flaky on a previously failing target keeps the issue open', () => {
    const s = summary([], {
      passedOn: { 'k:functional': ['chrome-canary'] },
      flaky: [{ key: 'k:functional', targetId: 'safari-tp' }],
    });
    expect(planIssueActions(s, open).actions).toEqual([]);
  });
  test('a check that ran nowhere keeps the issue open', () => {
    const s = summary([], { passedOn: { 'other:functional': ['safari-tp'] } });
    expect(planIssueActions(s, open).actions).toEqual([]);
  });
  test('an issue with no recorded failing targets is never auto-closed', () => {
    const s = summary([], { passedOn: { 'k:functional': ['chrome-canary'] } });
    expect(
      planIssueActions(s, [issue(9, 'open', 'k:functional', [], [])]).actions,
    ).toEqual([]);
  });
  test('passing on extra targets does not matter', () => {
    const s = summary([], {
      passedOn: {
        'k:functional': ['chrome-canary', 'firefox-nightly', 'safari-tp'],
      },
    });
    expect(planIssueActions(s, open).actions).toEqual([
      { type: 'close', issue: 8, key: 'k:functional' },
    ]);
  });
});

describe('mass failure', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      fail(`c${i}:functional`, ['safari-tp']),
    );

  test('thresholds are the documented values', () => {
    expect(MASS_FAILURE_MIN).toBe(5);
    expect(MASS_FAILURE_SHARE).toBe(0.3);
  });
  test('fewer than the minimum is never a mass failure, even at 100%', () => {
    const s = summary(many(MASS_FAILURE_MIN - 1));
    expect(s.totalKeys).toBe(MASS_FAILURE_MIN - 1);
    expect(planIssueActions(s, []).actions.map((a) => a.type)).toEqual(
      Array(MASS_FAILURE_MIN - 1).fill('create'),
    );
  });
  test('below the share is not a mass failure', () => {
    const s = summary(many(5), { totalKeys: 20 }); // 25%
    expect(planIssueActions(s, []).actions.map((a) => a.type)).toEqual(
      Array(5).fill('create'),
    );
  });
  test('exactly the minimum at exactly the share is a mass failure', () => {
    const s = summary(many(6), { totalKeys: 20 }); // 30%
    expect(planIssueActions(s, []).actions).toEqual([
      { type: 'run-broken', failures: s.failures },
    ]);
  });
  test('launch failures do not count toward the share', () => {
    const s = summary(many(2), {
      totalKeys: 2,
      launchFailures: ['a', 'b', 'c', 'd', 'e'].map((t) => ({
        targetId: `${t}-canary`,
        error: 'crashed',
      })),
    });
    expect(planIssueActions(s, []).actions.map((a) => a.type)).toEqual([
      'create',
      'create',
    ]);
  });
  test('names an open run-broken issue', () => {
    const s = summary(many(10), { totalKeys: 20 });
    const broken = issue(50, 'open', 'run-broken', [], []);
    expect(planIssueActions(s, [], broken).actions).toEqual([
      { type: 'run-broken', issue: 50, failures: s.failures },
    ]);
  });
  test('names a closed run-broken issue too, for reopening', () => {
    const s = summary(many(10), { totalKeys: 20 });
    const broken = issue(50, 'closed', 'run-broken', [], []);
    expect(planIssueActions(s, [], broken).actions).toEqual([
      { type: 'run-broken', issue: 50, failures: s.failures },
    ]);
  });
  test('takes no per-check action, not even closes', () => {
    const s = summary(many(10), {
      totalKeys: 20,
      passedOn: { 'k:functional': ['chrome-canary'] },
    });
    const existing = [
      issue(1, 'open', 'c0:functional', ['webkit'], ['safari-tp']),
      issue(2, 'open', 'k:functional', ['chromium'], ['chrome-canary']),
    ];
    expect(planIssueActions(s, existing)).toEqual({
      actions: [{ type: 'run-broken', failures: s.failures }],
      closedButFailing: [],
    });
  });
  test('a healthy run leaves the run-broken issue alone', () => {
    const broken = issue(50, 'open', 'run-broken', [], []);
    expect(
      planIssueActions(
        summary([fail('k:functional', ['chrome-canary'])]),
        [],
        broken,
      ).actions,
    ).toEqual([{ type: 'create', failure: expect.anything() }]);
  });
});

describe('matching existing issues', () => {
  test('a closed match without new engines is closed but failing, even on a new target', () => {
    const closed = [
      issue(4, 'closed', 'k:functional', ['chromium'], ['chrome-canary']),
    ];
    expect(
      planIssueActions(
        summary([fail('k:functional', ['chrome-canary', 'edge-canary'])]),
        closed,
      ),
    ).toEqual({
      actions: [],
      closedButFailing: [{ issue: 4, key: 'k:functional' }],
    });
  });
  test('a spread reopen carries the failure', () => {
    const s = summary([fail('k:functional', ['safari-tp', 'chrome-canary'])]);
    expect(
      planIssueActions(s, [
        issue(4, 'closed', 'k:functional', ['webkit'], ['safari-tp']),
      ]).actions,
    ).toEqual([
      { type: 'reopen', issue: 4, failure: s.failures[0], reason: 'spread' },
    ]);
  });
  test('the recovered label wins over the engine check', () => {
    const s = summary([fail('k:functional', ['safari-tp'])]);
    expect(
      planIssueActions(s, [
        issue(
          4,
          'closed',
          'k:functional',
          ['webkit'],
          ['safari-tp'],
          ['prerelease', 'prerelease:recovered'],
        ),
      ]).actions,
    ).toEqual([
      { type: 'reopen', issue: 4, failure: s.failures[0], reason: 'regressed' },
    ]);
  });
  test('several issues for one key prefer the open one', () => {
    const s = summary([fail('k:functional', ['safari-tp'])]);
    const existing = [
      issue(
        3,
        'closed',
        'k:functional',
        ['webkit'],
        ['safari-tp'],
        ['prerelease:recovered'],
      ),
      issue(2, 'open', 'k:functional', ['webkit'], ['safari-tp']),
      issue(9, 'closed', 'k:functional', ['webkit'], ['safari-tp']),
    ];
    expect(planIssueActions(s, existing).actions).toEqual([
      { type: 'update', issue: 2, failure: s.failures[0] },
    ]);
  });
  test('several closed issues for one key prefer the highest number', () => {
    const s = summary([fail('k:functional', ['safari-tp'])]);
    const existing = [
      issue(
        9,
        'closed',
        'k:functional',
        ['webkit'],
        ['safari-tp'],
        ['prerelease:recovered'],
      ),
      issue(3, 'closed', 'k:functional', ['webkit'], ['safari-tp']),
    ];
    expect(planIssueActions(s, existing).actions).toEqual([
      { type: 'reopen', issue: 9, failure: s.failures[0], reason: 'regressed' },
    ]);
  });
  test('closed issues for keys that did not fail are left alone', () => {
    const s = summary([], { passedOn: { 'k:functional': ['safari-tp'] } });
    expect(
      planIssueActions(s, [
        issue(4, 'closed', 'k:functional', ['webkit'], ['safari-tp']),
      ]),
    ).toEqual({ actions: [], closedButFailing: [] });
  });
});

describe('determinism', () => {
  const s = summary(
    [
      fail('b:functional', ['chrome-canary']),
      fail('a:privacy', ['firefox-nightly']),
      fail('d:functional', ['safari-tp', 'chrome-canary']),
      fail('e:functional', ['safari-tp']),
    ],
    {
      passedOn: {
        'c:functional': ['chrome-canary', 'safari-tp'],
        'f:functional': ['safari-tp'],
      },
    },
  );
  const existing = [
    issue(12, 'open', 'f:functional', ['webkit'], ['safari-tp']),
    issue(11, 'open', 'c:functional', ['chromium'], ['chrome-canary']),
    issue(10, 'open', 'c:functional', ['webkit'], ['safari-tp']),
    issue(7, 'closed', 'd:functional', ['webkit'], ['safari-tp']),
    issue(5, 'open', 'b:functional', ['chromium'], ['chrome-canary']),
    issue(3, 'closed', 'e:functional', ['webkit'], ['safari-tp']),
  ];

  test('actions are ordered by key, then issue number', () => {
    const plan = planIssueActions(s, existing);
    expect(
      plan.actions.map((a) => [a.type, 'issue' in a ? a.issue : undefined]),
    ).toEqual([
      ['create', undefined], // a:privacy
      ['update', 5], // b
      ['close', 10], // c
      ['close', 11], // c
      ['reopen', 7], // d spread to chromium
      ['close', 12], // f
    ]);
    expect(plan.closedButFailing).toEqual([{ issue: 3, key: 'e:functional' }]);
  });
  test('two runs on the same inputs give deep-equal plans', () => {
    expect(planIssueActions(s, existing)).toEqual(
      planIssueActions(s, existing),
    );
  });
  test('the order of existing issues does not change the plan', () => {
    expect(planIssueActions(s, [...existing].reverse())).toEqual(
      planIssueActions(s, existing),
    );
  });
  test('the order of failures does not change the plan', () => {
    const shuffled = { ...s, failures: [...s.failures].reverse() };
    expect(planIssueActions(shuffled, existing)).toEqual(
      planIssueActions(s, existing),
    );
  });
  test('the inputs are not mutated', () => {
    const before = structuredClone({ s, existing });
    planIssueActions(s, [...existing].reverse());
    expect({ s, existing }).toEqual(before);
  });
  test('applying a plan and planning again only updates', () => {
    // Issues as they stand after the first plan is applied.
    const applied = [
      issue(13, 'open', 'a:privacy', ['gecko'], ['firefox-nightly']),
      issue(5, 'open', 'b:functional', ['chromium'], ['chrome-canary']),
      issue(
        10,
        'closed',
        'c:functional',
        ['webkit'],
        ['safari-tp'],
        ['prerelease:recovered'],
      ),
      issue(
        11,
        'closed',
        'c:functional',
        ['chromium'],
        ['chrome-canary'],
        ['prerelease:recovered'],
      ),
      issue(
        7,
        'open',
        'd:functional',
        ['chromium', 'webkit'],
        ['chrome-canary', 'safari-tp'],
      ),
      issue(3, 'closed', 'e:functional', ['webkit'], ['safari-tp']),
      issue(
        12,
        'closed',
        'f:functional',
        ['webkit'],
        ['safari-tp'],
        ['prerelease:recovered'],
      ),
    ];
    const plan = planIssueActions(s, applied);
    expect(plan.actions.map((a) => a.type)).toEqual([
      'update',
      'update',
      'update',
    ]);
    expect(plan.closedButFailing).toEqual([{ issue: 3, key: 'e:functional' }]);
  });
});
