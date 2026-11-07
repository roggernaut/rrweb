import {
  MASS_FAILURE_MIN,
  MASS_FAILURE_SHARE,
  planIssueActions,
} from '../src/report/issues-plan.ts';
import { applyPlan, fail, issue, summary } from './helpers/results.ts';

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
    {
      type: 'update',
      issue: 1,
      failure: s.failures[0],
      recordTargets: ['chrome-canary'],
      recordEngines: ['chromium'],
    },
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
    heldBack: [],
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
      heldBack: [],
    });
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
      heldBack: [],
    });
  });
  test('a spread reopen carries the failure', () => {
    const s = summary([fail('k:functional', ['safari-tp', 'chrome-canary'])]);
    expect(
      planIssueActions(s, [
        issue(4, 'closed', 'k:functional', ['webkit'], ['safari-tp']),
      ]).actions,
    ).toEqual([
      {
        type: 'reopen',
        issue: 4,
        failure: s.failures[0],
        reason: 'spread',
        recordTargets: ['chrome-canary', 'safari-tp'],
        recordEngines: ['chromium', 'webkit'],
      },
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
      {
        type: 'reopen',
        issue: 4,
        failure: s.failures[0],
        reason: 'regressed',
        recordTargets: ['safari-tp'],
        recordEngines: ['webkit'],
      },
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
      {
        type: 'update',
        issue: 2,
        failure: s.failures[0],
        recordTargets: ['safari-tp'],
        recordEngines: ['webkit'],
      },
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
      {
        type: 'reopen',
        issue: 9,
        failure: s.failures[0],
        reason: 'regressed',
        recordTargets: ['safari-tp'],
        recordEngines: ['webkit'],
      },
    ]);
  });
  test('closed issues for keys that did not run are left alone', () => {
    const s = summary([], { passedOn: { 'other:functional': ['safari-tp'] } });
    expect(
      planIssueActions(s, [
        issue(4, 'closed', 'k:functional', ['webkit'], ['safari-tp']),
      ]),
    ).toEqual({ actions: [], closedButFailing: [], heldBack: [] });
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

describe('recorded targets and engines', () => {
  const A = 'chrome-canary';
  const B = 'safari-tp';

  test('a target that never confirmed a pass stays recorded until it does', () => {
    // Run 1: fails on A and B.
    let issues = applyPlan(
      [],
      planIssueActions(summary([fail('k:functional', [A, B])]), []),
    );
    expect(issues).toMatchObject([
      {
        number: 1,
        state: 'open',
        engines: ['chromium', 'webkit'],
        failingTargets: [A, B],
      },
    ]);

    // Run 2: fails on A; B is incomplete, so it neither failed nor passed.
    const run2 = summary([fail('k:functional', [A])], {
      incompleteTargets: [B],
    });
    const plan2 = planIssueActions(run2, issues);
    expect(plan2.actions).toEqual([
      {
        type: 'update',
        issue: 1,
        failure: run2.failures[0],
        recordTargets: [A, B],
        recordEngines: ['chromium', 'webkit'],
      },
    ]);
    issues = applyPlan(issues, plan2);

    // Run 3: A passes; B is missing. B never passed, so no close.
    const run3 = summary([], {
      passedOn: { 'k:functional': [A] },
      missingTargets: [B],
    });
    expect(planIssueActions(run3, issues).actions).toEqual([]);
  });
  test('an earlier target that passed this run drops out, with its engine', () => {
    const s = summary([fail('k:functional', [A])], {
      passedOn: { 'k:functional': [B] },
    });
    const open = [
      issue(1, 'open', 'k:functional', ['chromium', 'webkit'], [A, B]),
    ];
    expect(planIssueActions(s, open).actions).toMatchObject([
      { type: 'update', recordTargets: [A], recordEngines: ['chromium'] },
    ]);
  });
  test('a reopen keeps earlier unconfirmed targets too', () => {
    const s = summary([fail('k:functional', [A])], { missingTargets: [B] });
    const closed = [
      issue(
        1,
        'closed',
        'k:functional',
        ['webkit'],
        [B],
        ['prerelease:recovered'],
      ),
    ];
    expect(planIssueActions(s, closed).actions).toMatchObject([
      {
        type: 'reopen',
        reason: 'regressed',
        recordTargets: [A, B],
        recordEngines: ['chromium', 'webkit'],
      },
    ]);
  });
});

describe('issues closed by hand or by a fixing PR', () => {
  test('a closed issue whose failing targets all passed is marked recovered', () => {
    const s = summary([], {
      passedOn: { 'k:functional': ['chrome-canary', 'safari-tp'] },
    });
    const closed = [
      issue(4, 'closed', 'k:functional', ['webkit'], ['safari-tp']),
    ];
    expect(planIssueActions(s, closed)).toEqual({
      actions: [{ type: 'mark-recovered', issue: 4, key: 'k:functional' }],
      closedButFailing: [],
      heldBack: [],
    });
  });
  test('a later failure on the same engine then reopens as regressed', () => {
    let issues = [
      issue(4, 'closed', 'k:functional', ['webkit'], ['safari-tp']),
    ];
    issues = applyPlan(
      issues,
      planIssueActions(
        summary([], { passedOn: { 'k:functional': ['safari-tp'] } }),
        issues,
      ),
    );
    expect(
      planIssueActions(summary([fail('k:functional', ['safari-tp'])]), issues)
        .actions,
    ).toMatchObject([{ type: 'reopen', issue: 4, reason: 'regressed' }]);
  });
  test('is not marked recovered while a failing target is unconfirmed', () => {
    const s = summary([], {
      passedOn: { 'k:functional': ['chrome-canary'] },
      incompleteTargets: ['safari-tp'],
    });
    const closed = [
      issue(
        4,
        'closed',
        'k:functional',
        ['chromium', 'webkit'],
        ['chrome-canary', 'safari-tp'],
      ),
    ];
    expect(planIssueActions(s, closed).actions).toEqual([]);
  });
  test('is not marked recovered with no recorded failing targets', () => {
    const s = summary([], { passedOn: { 'k:functional': ['safari-tp'] } });
    expect(
      planIssueActions(s, [issue(4, 'closed', 'k:functional', [], [])]).actions,
    ).toEqual([]);
  });
  test('an issue already marked recovered is left alone', () => {
    const s = summary([], { passedOn: { 'k:functional': ['safari-tp'] } });
    const closed = [
      issue(
        4,
        'closed',
        'k:functional',
        ['webkit'],
        ['safari-tp'],
        ['prerelease:recovered'],
      ),
    ];
    expect(planIssueActions(s, closed).actions).toEqual([]);
  });
});

describe('closing a healed run-broken issue', () => {
  const healthy = (o: Parameters<typeof summary>[1] = {}) =>
    summary([fail('k:functional', ['chrome-canary'])], {
      passedOn: { 'j:functional': ['chrome-canary'] },
      ...o,
    });
  const broken = (state: 'open' | 'closed') =>
    issue(50, state, 'run-broken', [], []);

  test('a complete, healthy run closes an open run-broken issue', () => {
    expect(planIssueActions(healthy(), [], broken('open')).actions).toEqual([
      { type: 'create', failure: expect.anything() },
      { type: 'close-run-broken', issue: 50 },
    ]);
  });
  test('is sorted alongside the other actions by key', () => {
    const s = summary([fail('z:functional', ['chrome-canary'])]);
    expect(
      planIssueActions(s, [], broken('open')).actions.map((a) => a.type),
    ).toEqual(['close-run-broken', 'create']);
  });
  test('not while a target is incomplete', () => {
    expect(
      planIssueActions(
        healthy({ incompleteTargets: ['safari-tp'] }),
        [],
        broken('open'),
      ).actions.map((a) => a.type),
    ).toEqual(['create']);
  });
  test('not while a target is missing', () => {
    expect(
      planIssueActions(
        healthy({ missingTargets: ['safari-tp'] }),
        [],
        broken('open'),
      ).actions.map((a) => a.type),
    ).toEqual(['create']);
  });
  test('not when it is already closed', () => {
    expect(
      planIssueActions(healthy(), [], broken('closed')).actions.map(
        (a) => a.type,
      ),
    ).toEqual(['create']);
  });
});

describe('the per-run issue cap', () => {
  // a: 1 engine, 1 target; b: 2 engines, 2 targets; c: 2 engines, 3
  // targets; z: privacy on 1 engine and 1 target.
  const four = () => [
    fail('a:functional', ['chrome-canary']),
    fail('b:functional', ['chrome-canary', 'firefox-nightly']),
    fail('c:functional', ['chrome-canary', 'chrome-dev', 'firefox-nightly']),
    fail('z:privacy', ['safari-tp']),
  ];

  test('keeps privacy first, then more engines, then more targets, and holds back the rest', () => {
    const s = summary(four());
    const plan = planIssueActions(s, [], undefined, 2);
    expect(plan.actions).toEqual([
      { type: 'create', failure: s.failures[2] },
      { type: 'create', failure: s.failures[3] },
    ]);
    expect(plan.heldBack).toEqual([
      {
        key: 'b:functional',
        engines: ['chromium', 'gecko'],
        targets: ['chrome-canary', 'firefox-nightly'],
      },
      {
        key: 'a:functional',
        engines: ['chromium'],
        targets: ['chrome-canary'],
      },
    ]);
    // Whatever order the failures and issues come in.
    const reversed = { ...s, failures: [...s.failures].reverse() };
    expect(planIssueActions(reversed, [], undefined, 2)).toEqual(plan);
  });

  test('ties go to the lower key', () => {
    const s = summary([
      fail('b:functional', ['chrome-canary']),
      fail('a:functional', ['chrome-canary']),
    ]);
    const plan = planIssueActions(s, [], undefined, 1);
    expect(plan.actions).toEqual([{ type: 'create', failure: s.failures[0] }]);
    expect(plan.heldBack.map((h) => h.key)).toEqual(['b:functional']);
  });

  test('with no cap nothing is held back', () => {
    const plan = planIssueActions(summary(four()), []);
    expect(plan.actions.map((a) => a.type)).toEqual([
      'create',
      'create',
      'create',
      'create',
    ]);
    expect(plan.heldBack).toEqual([]);
  });

  test('a reopen takes a slot; updates never do', () => {
    const s = summary([
      fail('a:functional', ['chrome-canary']),
      fail('b:functional', ['chrome-canary']),
      fail('c:functional', ['chrome-canary']),
      fail('d:functional', ['chrome-canary']),
    ]);
    const issues = [
      issue(1, 'open', 'a:functional', ['chromium'], ['chrome-canary']),
      issue(2, 'open', 'b:functional', ['chromium'], ['chrome-canary']),
      issue(3, 'open', 'c:functional', ['chromium'], ['chrome-canary']),
      issue(
        4,
        'closed',
        'd:functional',
        ['chromium'],
        ['chrome-canary'],
        ['prerelease:recovered'],
      ),
    ];
    const plan = planIssueActions(s, issues, undefined, 1);
    expect(plan.actions.map((a) => a.type)).toEqual([
      'update',
      'update',
      'update',
      'reopen',
    ]);
    expect(plan.heldBack).toEqual([]);
  });

  test('a reopen counts toward the cap like a create', () => {
    const s = summary([
      fail('a:functional', ['chrome-canary']),
      fail('r:functional', ['chrome-canary', 'firefox-nightly']),
    ]);
    const closed = [
      issue(
        4,
        'closed',
        'r:functional',
        ['chromium', 'gecko'],
        ['chrome-canary', 'firefox-nightly'],
        ['prerelease:recovered'],
      ),
    ];
    const plan = planIssueActions(s, closed, undefined, 1);
    expect(plan.actions).toMatchObject([
      { type: 'reopen', issue: 4, reason: 'regressed' },
    ]);
    expect(plan.heldBack.map((h) => h.key)).toEqual(['a:functional']);
  });

  test('a held-back failure closes nothing and competes again next run', () => {
    // x passed on the target its closed issue recorded, which alone would
    // mark the issue recovered, but it spread to gecko: a reopen.
    const s = summary(
      [
        fail('p:privacy', ['chrome-canary']),
        fail('x:functional', ['firefox-nightly']),
      ],
      { passedOn: { 'x:functional': ['chrome-canary'] } },
    );
    const closed = [
      issue(3, 'closed', 'x:functional', ['chromium'], ['chrome-canary']),
    ];
    expect(planIssueActions(s, closed).actions).toMatchObject([
      { type: 'create' },
      { type: 'reopen', issue: 3, reason: 'spread' },
    ]);

    const plan = planIssueActions(s, closed, undefined, 1);
    expect(plan.actions).toEqual([{ type: 'create', failure: s.failures[0] }]);
    expect(plan.heldBack).toEqual([
      { key: 'x:functional', engines: ['gecko'], targets: ['firefox-nightly'] },
    ]);
    expect(plan.closedButFailing).toEqual([]);

    const next = planIssueActions(s, applyPlan(closed, plan), undefined, 1);
    expect(next.actions).toMatchObject([
      { type: 'update' },
      { type: 'reopen', issue: 3, reason: 'spread' },
    ]);
    expect(next.heldBack).toEqual([]);
  });

  test('a re-run of the report keeps the slots this run already used', () => {
    const s = summary(four());
    const first = planIssueActions(s, [], undefined, 2);
    const opened = applyPlan([], first).map((i) => ({
      ...i,
      notifiedThisRun: true,
    }));
    const again = planIssueActions(s, opened, undefined, 2);
    expect(again.actions.map((a) => a.type)).toEqual(['update', 'update']);
    expect(again.heldBack).toEqual(first.heldBack);
  });

  test('a mass failure still collapses into run-broken and holds nothing back', () => {
    const s = summary(
      Array.from({ length: 10 }, (_, i) =>
        fail(`c${i}:functional`, ['safari-tp']),
      ),
      { totalKeys: 20 },
    );
    expect(planIssueActions(s, [], undefined, 2)).toEqual({
      actions: [{ type: 'run-broken', failures: s.failures }],
      closedButFailing: [],
      heldBack: [],
    });
  });

  test('a cap must be a positive integer', () => {
    const s = summary(four());
    for (const cap of [0, -1, 1.5, Number.NaN]) {
      expect(() => planIssueActions(s, [], undefined, cap)).toThrow(
        /positive integer/,
      );
    }
  });
});
