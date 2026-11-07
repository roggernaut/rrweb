import { fileURLToPath } from 'node:url';
import { readResults, type TargetResult } from '../src/node/results.ts';
import {
  GitHub,
  type IssueData,
  type IssuePatch,
  type NewIssue,
} from '../src/report/github.ts';
import {
  parseCli,
  reconcile,
  runMetaFromEnv,
  type GitHubLike,
} from '../src/report/reconcile.ts';
import { parseMarkers, type RunMeta } from '../src/report/render.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CheckKind } from '../src/types.ts';
import { countLine, failing, incomplete, passing } from './helpers/results.ts';

/** An in-memory GitHub with the client's method names. */
function fakeGitHub(seed: Array<Partial<IssueData>> = []) {
  const issues: IssueData[] = seed.map((s, i) => ({
    number: i + 1,
    state: 'open',
    title: `seed ${i + 1}`,
    labels: ['prerelease'],
    body: '',
    node_id: `node-${i + 1}`,
    ...s,
  }));
  const created: Array<NewIssue & { number: number }> = [];
  const updates: Array<{ number: number; patch: IssuePatch }> = [];
  const comments: Array<{ number: number; body: string }> = [];
  const pinned: string[] = [];
  const ensured: string[][] = [];
  const find = (n: number) => {
    const i = issues.find((x) => x.number === n);
    if (!i) throw new Error(`no issue ${n}`);
    return i;
  };
  const gh: GitHubLike = {
    async listIssues(label) {
      return issues
        .filter((i) => i.labels.includes(label))
        .map((i) => ({ ...i, labels: [...i.labels] }));
    },
    async createIssue(issue) {
      const number = issues.length + 1;
      issues.push({
        number,
        state: 'open',
        ...issue,
        labels: [...issue.labels],
        node_id: `node-${number}`,
      });
      created.push({ ...issue, number });
      return { number, node_id: `node-${number}` };
    },
    async updateIssue(number, patch) {
      const i = find(number);
      updates.push({ number, patch });
      if (patch.title !== undefined) i.title = patch.title;
      if (patch.body !== undefined) i.body = patch.body;
      if (patch.state !== undefined) i.state = patch.state;
      if (patch.labels !== undefined) i.labels = [...patch.labels];
    },
    async comment(number, body) {
      find(number);
      comments.push({ number, body });
    },
    async ensureLabels(names) {
      ensured.push([...names]);
    },
    async pinIssue(nodeId) {
      pinned.push(nodeId);
    },
  };
  return { ...gh, issues, created, updates, comments, pinned, ensured };
}

const run: RunMeta = {
  runUrl: 'https://github.com/rrweb-io/rrweb/actions/runs/1',
  runId: '1',
  date: '2026-11-06',
  rrwebCommit: 'abc123',
};
const runN = (n: number): RunMeta => ({
  runUrl: `https://github.com/rrweb-io/rrweb/actions/runs/${n}`,
  runId: String(n),
  date: `2026-11-${String(n).padStart(2, '0')}`,
  rrwebCommit: 'abc123',
});
const expected = ['chrome-canary', 'chrome-stable'];
const KEY = 'css-nested-rules:functional';
let fixtureResults: TargetResult[];

beforeAll(async () => {
  fixtureResults = await readResults(
    fileURLToPath(new URL('./fixtures/results', import.meta.url)),
  );
});

const keyed = (gh: ReturnType<typeof fakeGitHub>, key = KEY) =>
  gh.issues.filter((i) => parseMarkers(i.body).key === key);
const statusIssues = (gh: ReturnType<typeof fakeGitHub>) =>
  gh.issues.filter((i) => i.body.includes('<!-- prerelease:status -->'));

test('two reconciles of the same results create each issue once', async () => {
  const gh = fakeGitHub();
  await reconcile({ gh, results: fixtureResults, expected, apply: true });
  await reconcile({ gh, results: fixtureResults, expected, apply: true });
  expect(
    gh.created.filter((i) => i.labels.includes('prerelease:functional')),
  ).toHaveLength(1);
  expect(
    gh.created.filter((i) => i.labels.includes('prerelease:status')),
  ).toHaveLength(1);
  expect(gh.comments).toHaveLength(0);
});

test('the second pass leaves an unchanged issue alone', async () => {
  const gh = fakeGitHub();
  await reconcile({ gh, results: fixtureResults, expected, apply: true, run });
  const before = gh.updates.length;
  await reconcile({ gh, results: fixtureResults, expected, apply: true, run });
  expect(gh.updates.slice(before)).toEqual([]);
});

test('a dry run plans without writing', async () => {
  const gh = fakeGitHub();
  const plan = await reconcile({
    gh,
    results: fixtureResults,
    expected,
    apply: false,
    run,
  });
  expect(plan.actions.map((a) => a.type)).toEqual(['create']);
  expect(gh.created).toEqual([]);
  expect(gh.updates).toEqual([]);
  expect(gh.ensured).toEqual([]);
  expect(gh.pinned).toEqual([]);
});

test('a new failure opens an issue with its labels, and the status issue is pinned', async () => {
  const gh = fakeGitHub();
  await reconcile({ gh, results: fixtureResults, expected, apply: true, run });
  const [issue] = keyed(gh);
  expect(issue).toMatchObject({
    state: 'open',
    title: 'css-nested-rules fails on chromium (upcoming builds only)',
    labels: ['prerelease', 'prerelease:functional', 'engine:chromium'],
  });
  expect(parseMarkers(issue.body).targets).toEqual(['chrome-canary']);
  const [status] = statusIssues(gh);
  expect(status.labels).toEqual(['prerelease', 'prerelease:status']);
  expect(status.body).toMatch(new RegExp(`#${issue.number} \`${KEY}\``));
  expect(gh.pinned).toEqual([status.node_id]);
  expect(gh.ensured.flat()).toEqual(
    expect.arrayContaining([
      'prerelease',
      'prerelease:functional',
      'engine:chromium',
      'prerelease:status',
      'prerelease:recovered',
    ]),
  );
});

test('a new privacy failure opens an issue labelled privacy, not prerelease:privacy', async () => {
  const gh = fakeGitHub();
  const r = failing('safari-tp', 'mask-check');
  r.checks['mask-check'].kind = 'privacy';
  await reconcile({
    gh,
    results: [r],
    expected: ['safari-tp'],
    apply: true,
    run,
  });
  const [issue] = gh.created.filter((i) => parseMarkers(i.body).key);
  expect(issue).toMatchObject({
    title: 'mask-check fails on webkit (upcoming builds only)',
    labels: ['prerelease', 'privacy', 'engine:webkit'],
  });
  expect(gh.ensured.flat()).toContain('privacy');
  expect(gh.ensured.flat()).not.toContain('prerelease:privacy');
  expect(gh.ensured.flat()).not.toContain('severity:critical');
});

test('recovery closes with one comment and the recovered label', async () => {
  const gh = fakeGitHub();
  const fail = [failing('chrome-canary', 'css-nested-rules')];
  const pass = [passing('chrome-canary', 'css-nested-rules')];
  await reconcile({
    gh,
    results: fail,
    expected: ['chrome-canary'],
    apply: true,
    run: runN(1),
  });
  await reconcile({
    gh,
    results: pass,
    expected: ['chrome-canary'],
    apply: true,
    run: runN(2),
  });
  const [issue] = keyed(gh);
  expect(issue.state).toBe('closed');
  expect(issue.labels).toContain('prerelease:recovered');
  expect(gh.comments).toEqual([
    {
      number: issue.number,
      body: `Passed on every target that failed before, in [the run of 2026-11-02](${
        runN(2).runUrl
      }).`,
    },
  ]);
  expect(gh.updates.at(-2)).toMatchObject({
    number: issue.number,
    patch: { state: 'closed', state_reason: 'completed' },
  });
});

test('a regression reopens with one comment and drops the recovered label', async () => {
  const gh = fakeGitHub();
  const fail = [failing('chrome-canary', 'css-nested-rules')];
  const pass = [passing('chrome-canary', 'css-nested-rules')];
  const opts = { gh, expected: ['chrome-canary'], apply: true };
  await reconcile({ ...opts, results: fail, run: runN(1) });
  await reconcile({ ...opts, results: pass, run: runN(2) });
  await reconcile({ ...opts, results: fail, run: runN(3) });
  const [issue] = keyed(gh);
  expect(issue.state).toBe('open');
  expect(issue.labels).not.toContain('prerelease:recovered');
  expect(gh.comments.map((c) => c.body)).toEqual([
    expect.stringMatching(/^Passed on every target/),
    `Failing again in [the run of 2026-11-03](${runN(3).runUrl}).`,
  ]);
  expect(parseMarkers(issue.body).history).toHaveLength(2);
});

test('mark-recovered only adds the label', async () => {
  const gh = fakeGitHub([
    {
      state: 'closed',
      labels: [
        'prerelease',
        'prerelease:functional',
        'engine:chromium',
        'fixed-by-pr',
      ],
      body: '<!-- prerelease:key=css-nested-rules:functional -->\n<!-- prerelease:engines=chromium -->\n<!-- prerelease:targets=chrome-canary -->\n',
    },
  ]);
  const body = gh.issues[0].body;
  await reconcile({
    gh,
    results: [passing('chrome-canary', 'css-nested-rules')],
    expected: ['chrome-canary'],
    apply: true,
    run,
  });
  expect(gh.comments).toEqual([]);
  expect(gh.updates.filter((u) => u.number === 1)).toEqual([
    {
      number: 1,
      patch: {
        labels: [
          'prerelease',
          'prerelease:functional',
          'engine:chromium',
          'fixed-by-pr',
          'prerelease:recovered',
        ],
      },
    },
  ]);
  expect(gh.issues[0]).toMatchObject({ state: 'closed', body });
});

test('an update keeps labels a maintainer added', async () => {
  const gh = fakeGitHub([
    {
      labels: [
        'prerelease',
        'prerelease:functional',
        'engine:gecko',
        'triaged',
      ],
      body: '<!-- prerelease:key=css-nested-rules:functional -->\n<!-- prerelease:engines=chromium -->\n<!-- prerelease:targets=chrome-canary -->\n',
    },
  ]);
  await reconcile({ gh, results: fixtureResults, expected, apply: true, run });
  expect(gh.issues[0].labels).toEqual([
    'prerelease',
    'prerelease:functional',
    'triaged',
    'engine:chromium',
  ]);
  expect(gh.comments).toEqual([]);
});

test('an update drops the labels only this suite added and keeps the rest', async () => {
  const gh = fakeGitHub([
    {
      title: '[pre-release] functional: css-nested-rules fails on chromium',
      labels: [
        'prerelease',
        'prerelease:functional',
        'prerelease:also-fails-on-stable',
        'prerelease:privacy',
        'severity:critical',
        'engine:gecko',
        'triaged',
      ],
      body: '<!-- prerelease:key=css-nested-rules:functional -->\n<!-- prerelease:engines=chromium -->\n<!-- prerelease:targets=chrome-canary -->\n',
    },
  ]);
  await reconcile({ gh, results: fixtureResults, expected, apply: true, run });
  expect(gh.issues[0].title).toBe(
    'css-nested-rules fails on chromium (upcoming builds only)',
  );
  expect(gh.issues[0].labels).toEqual([
    'prerelease',
    'prerelease:functional',
    'severity:critical',
    'triaged',
    'engine:chromium',
  ]);
});

const MARKERS_3 =
  '<!-- prerelease:key=privacy-canvas-block:privacy -->\n<!-- prerelease:engines=chromium,gecko,webkit -->\n<!-- prerelease:targets=local-chromium,local-firefox,local-webkit -->\n';
const TITLE_3 = 'privacy-canvas-block fails on chromium, gecko, webkit';
const LABELS_3 = [
  'prerelease',
  'privacy',
  'engine:chromium',
  'engine:gecko',
  'engine:webkit',
];

test('a partial run keeps a hand-fixed title and labels untouched', async () => {
  const gh = fakeGitHub([
    { title: TITLE_3, labels: [...LABELS_3], body: MARKERS_3 },
  ]);
  const before = gh.issues[0].body;
  await reconcile({
    gh,
    results: [passing('chrome-canary', 'css-nested-rules')],
    expected: ['chrome-canary'],
    apply: true,
    run,
  });
  expect(gh.updates.filter((u) => u.number === 1)).toEqual([]);
  expect(gh.issues[0]).toMatchObject({
    title: TITLE_3,
    labels: LABELS_3,
    body: before,
  });
});

test('an update never claims upcoming-only while a carried target is kept', async () => {
  const gh = fakeGitHub([
    { title: TITLE_3, labels: [...LABELS_3], body: MARKERS_3 },
  ]);
  const r = failing('chrome-canary', 'privacy-canvas-block');
  r.checks['privacy-canvas-block'].kind = 'privacy';
  await reconcile({
    gh,
    results: [r],
    expected: ['chrome-canary'],
    apply: true,
    run,
  });
  expect(gh.issues[0].title).toBe(TITLE_3);
  expect(gh.issues[0].labels.sort()).toEqual([...LABELS_3].sort());
  expect(parseMarkers(gh.issues[0].body).targets).toEqual([
    'chrome-canary',
    'local-chromium',
    'local-firefox',
    'local-webkit',
  ]);
});

test('an existing stable target in the markers means no upcoming-only suffix', async () => {
  const gh = fakeGitHub([
    {
      title: 'css-nested-rules fails on chromium',
      labels: ['prerelease', 'prerelease:functional', 'engine:chromium'],
      body: '<!-- prerelease:key=css-nested-rules:functional -->\n<!-- prerelease:engines=chromium -->\n<!-- prerelease:targets=chrome-canary,chrome-stable -->\n',
    },
  ]);
  // Only the upcoming target fails in this run; stable is absent from it.
  await reconcile({
    gh,
    results: fixtureResults.filter((r) => r.targetId === 'chrome-canary'),
    expected: ['chrome-canary'],
    apply: true,
    run,
  });
  expect(gh.issues[0].title).toBe('css-nested-rules fails on chromium');
});

test('the status issue is retitled only while it has the old prefix', async () => {
  const mk = (title: string) =>
    fakeGitHub([
      {
        title,
        labels: ['prerelease', 'prerelease:status'],
        body: '<!-- prerelease:status -->\nold',
      },
    ]);
  const old = mk('[pre-release] Status of the latest run');
  await reconcile({
    gh: old,
    results: fixtureResults,
    expected,
    apply: true,
    run,
  });
  expect(old.issues[0].title).toBe(
    'Pre-release browsers: status of the latest run',
  );
  const edited = mk('Our own status title');
  await reconcile({
    gh: edited,
    results: fixtureResults,
    expected,
    apply: true,
    run,
  });
  expect(edited.issues[0].title).toBe('Our own status title');
  expect(edited.issues[0].body).not.toBe('<!-- prerelease:status -->\nold');
});

/** One target on which `n` functional checks fail. */
function massFailure(n: number): TargetResult[] {
  const r = failing('chrome-canary', 'c0');
  for (let i = 1; i < n; i++)
    r.checks[`c${i}`] = { ...r.checks.c0, message: `c${i} broke` };
  return [r];
}

test('a mass failure opens one run-broken issue and nothing else', async () => {
  const gh = fakeGitHub();
  await reconcile({
    gh,
    results: massFailure(6),
    expected: ['chrome-canary'],
    apply: true,
    run,
  });
  const [broken] = gh.issues.filter((i) =>
    i.body.includes('<!-- prerelease:run-broken -->'),
  );
  expect(broken.labels).toEqual(['prerelease', 'prerelease:run-broken']);
  expect(broken.title).toBe(
    'Pre-release browsers: run broken, 6 checks failed',
  );
  expect(gh.issues.filter((i) => parseMarkers(i.body).key)).toEqual([]);
  expect(statusIssues(gh)[0].body).toMatch(/### Run broken[\s\S]*#1/);
});

test('a closed run-broken issue reopens with one comment', async () => {
  const gh = fakeGitHub([
    {
      state: 'closed',
      labels: ['prerelease', 'prerelease:run-broken'],
      body: '<!-- prerelease:run-broken -->\nold',
    },
  ]);
  await reconcile({
    gh,
    results: massFailure(6),
    expected: ['chrome-canary'],
    apply: true,
    run,
  });
  expect(gh.issues[0].state).toBe('open');
  expect(gh.issues[0].body).toContain('6 of the 6 checks');
  expect(gh.comments).toEqual([
    {
      number: 1,
      body: `Broken again in [the run of 2026-11-06](${run.runUrl}).`,
    },
  ]);
});

test('an open run-broken issue updates without a comment', async () => {
  const gh = fakeGitHub([
    {
      labels: ['prerelease', 'prerelease:run-broken'],
      body: '<!-- prerelease:run-broken -->\nold',
    },
  ]);
  await reconcile({
    gh,
    results: massFailure(6),
    expected: ['chrome-canary'],
    apply: true,
    run,
  });
  expect(gh.issues[0].body).toContain('6 of the 6 checks');
  expect(gh.comments).toEqual([]);
  expect(
    gh.created.filter((i) => i.labels.includes('prerelease:run-broken')),
  ).toEqual([]);
});

test('a healthy complete run closes the run-broken issue with a comment', async () => {
  const gh = fakeGitHub([
    {
      labels: ['prerelease', 'prerelease:run-broken'],
      body: '<!-- prerelease:run-broken -->\nold',
    },
  ]);
  await reconcile({
    gh,
    results: [passing('chrome-canary', 'css-nested-rules')],
    expected: ['chrome-canary'],
    apply: true,
    run,
  });
  expect(gh.comments).toEqual([
    {
      number: 1,
      body: `Run healthy again in [the run of 2026-11-06](${run.runUrl}).`,
    },
  ]);
  expect(gh.issues[0].state).toBe('closed');
  expect(gh.updates).toContainEqual({
    number: 1,
    patch: { state: 'closed', state_reason: 'completed' },
  });
});

test('missing BrowserStack results keep the run-broken issue open and show in the status', async () => {
  const gh = fakeGitHub([
    {
      labels: ['prerelease', 'prerelease:run-broken'],
      body: '<!-- prerelease:run-broken -->\nold',
    },
  ]);
  const plan = await reconcile({
    gh,
    results: [passing('chrome-canary', 'css-nested-rules')],
    expected: ['chrome-canary'],
    apply: true,
    run,
    browserstackMissing: true,
  });
  expect(plan.actions).toEqual([]);
  expect(gh.issues[0].state).toBe('open');
  expect(statusIssues(gh)[0].body).toMatch(
    /### Missing\n\n- BrowserStack: no results/,
  );
});

test('a run with no results at all, as after a failed build, closes nothing and lists every target missing', async () => {
  const gh = fakeGitHub([
    {
      labels: ['prerelease', 'prerelease:run-broken'],
      body: '<!-- prerelease:run-broken -->\nold',
    },
  ]);
  await reconcile({
    gh,
    results: [failing('chrome-canary', 'css-nested-rules')],
    expected,
    apply: true,
    run: runN(1),
  });
  const plan = await reconcile({
    gh,
    results: [],
    expected,
    apply: true,
    run: runN(2),
    browserstackMissing: true,
  });
  expect(plan.actions).toEqual([]);
  expect(keyed(gh)[0].state).toBe('open');
  expect(gh.issues[0].state).toBe('open');
  const body = statusIssues(gh)[0].body;
  for (const id of expected) {
    expect(body).toMatch(new RegExp(`${id}\\W*: no results`));
  }
  expect(body).toContain('BrowserStack: no results');
});

test('a partial run plans as before, keeps a left-out issue open, and says partial', async () => {
  const gh = fakeGitHub();
  await reconcile({
    gh,
    results: [failing('safari-tp', 'css-nested-rules')],
    expected: ['safari-tp'],
    apply: true,
    run: runN(1),
  });
  const args = {
    results: [passing('chrome-canary', 'css-nested-rules')],
    expected: ['chrome-canary'],
    apply: false,
    run: runN(2),
  };
  const without = await reconcile({ gh, ...args });
  const partial = await reconcile({
    gh,
    ...args,
    apply: true,
    leftOut: ['safari-tp', 'browserstack'],
  });
  expect(partial).toEqual(without);
  expect(keyed(gh)[0].state).toBe('open');
  const body = statusIssues(gh)[0].body;
  expect(body).toContain('is a **partial run**');
  expect(body).toMatch(
    /### Not covered by this run\n\n- safari-tp\n- BrowserStack/,
  );
});

test('a clean partial run leaves the run-broken issue open', async () => {
  const gh = fakeGitHub([
    {
      labels: ['prerelease', 'prerelease:run-broken'],
      body: '<!-- prerelease:run-broken -->\nold',
    },
  ]);
  const args = {
    gh,
    results: [passing('chrome-canary', 'css-nested-rules')],
    expected: ['chrome-canary'],
    run,
  };
  // Without the left-out list, the same run would close it.
  expect((await reconcile({ ...args, apply: false })).actions).toEqual([
    { type: 'close-run-broken', issue: 1 },
  ]);
  const plan = await reconcile({
    ...args,
    apply: true,
    leftOut: ['safari-tp', 'browserstack'],
  });
  expect(plan.actions).toEqual([]);
  expect(gh.issues[0].state).toBe('open');
  expect(gh.comments).toEqual([]);
  const body = statusIssues(gh)[0].body;
  expect(body).toMatch(/### Missing\n\nNone\./);
  expect(body).toMatch(
    /### Not covered by this run\n\n- safari-tp\n- BrowserStack/,
  );
});

test('an existing status issue is rewritten in place, not pinned again', async () => {
  const gh = fakeGitHub([
    {
      labels: ['prerelease', 'prerelease:status'],
      body: '<!-- prerelease:status -->\nold',
    },
  ]);
  await reconcile({ gh, results: fixtureResults, expected, apply: true, run });
  expect(statusIssues(gh)).toHaveLength(1);
  expect(gh.issues[0].body).toContain('## Latest run: 2026-11-06');
  expect(gh.pinned).toEqual([]);
});

test('a failed pin warns and the step still succeeds', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const gh = fakeGitHub();
    gh.pinIssue = () => Promise.reject(new Error('too many pinned issues'));
    await expect(
      reconcile({ gh, results: fixtureResults, expected, apply: true, run }),
    ).resolves.toBeDefined();
    expect(statusIssues(gh)).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(
      /could not pin status #\d+: too many pinned issues/,
    );
  } finally {
    warn.mockRestore();
  }
});

test('three runs: a target that went incomplete stays recorded and blocks the close', async () => {
  const gh = fakeGitHub();
  const exp = ['chrome-canary', 'chrome-dev', 'chrome-stable'];
  const check = 'css-nested-rules';
  const opts = { gh, expected: exp, apply: true };

  // Run 1: fails on canary.
  await reconcile({
    ...opts,
    run: runN(1),
    results: [
      failing('chrome-canary', check),
      passing('chrome-dev', check),
      passing('chrome-stable', check),
    ],
  });
  // Run 2: canary stops before the check; dev fails now.
  await reconcile({
    ...opts,
    run: runN(2),
    results: [
      incomplete('chrome-canary', { checkId: check }),
      failing('chrome-dev', check),
      passing('chrome-stable', check),
    ],
  });
  let [issue] = keyed(gh);
  expect(parseMarkers(issue.body).targets).toEqual([
    'chrome-canary',
    'chrome-dev',
  ]);

  // Run 3: dev passes, canary still did not run the check.
  const plan = await reconcile({
    ...opts,
    run: runN(3),
    results: [
      incomplete('chrome-canary', { checkId: check }),
      passing('chrome-dev', check),
      passing('chrome-stable', check),
    ],
  });
  expect(plan.actions).toEqual([]);
  [issue] = keyed(gh);
  expect(issue.state).toBe('open');
  expect(parseMarkers(issue.body).targets).toEqual([
    'chrome-canary',
    'chrome-dev',
  ]);
  expect(
    gh.created.filter((i) => i.labels.includes('prerelease:functional')),
  ).toHaveLength(1);
  expect(gh.comments).toEqual([]);
  expect(statusIssues(gh)[0].body).toMatch(/chrome-canary: `deadline`/);
});

describe('GitHub client', () => {
  type Call = {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  function client(respond: (call: Call) => { status?: number; json: unknown }) {
    const calls: Call[] = [];
    const fetchFn = (async (url: string, init: RequestInit = {}) => {
      const call: Call = {
        url: String(url),
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string>,
        ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
      };
      calls.push(call);
      const r = respond(call);
      return new Response(JSON.stringify(r.json), {
        status: r.status ?? 200,
        statusText: r.status === 404 ? 'Not Found' : 'OK',
      });
    }) as typeof fetch;
    const gh = new GitHub({
      token: 'tok-secret',
      repository: 'o/r',
      apiUrl: 'https://api.example',
      fetch: fetchFn,
    });
    return { gh, calls };
  }
  const rawIssue = (n: number, extra: object = {}) => ({
    number: n,
    state: 'open',
    title: `t${n}`,
    labels: [{ name: 'prerelease' }],
    body: null,
    node_id: `I_${n}`,
    ...extra,
  });

  test('listIssues pages through every state and drops pull requests', async () => {
    const { gh, calls } = client(({ url }) => {
      const page = Number(new URL(url).searchParams.get('page'));
      if (page === 1)
        return {
          json: Array.from({ length: 100 }, (_, i) =>
            rawIssue(i + 1, i === 0 ? { pull_request: {} } : {}),
          ),
        };
      return { json: [rawIssue(101), rawIssue(102, { state: 'closed' })] };
    });
    const issues = await gh.listIssues('prerelease');
    expect(issues).toHaveLength(101);
    expect(issues[0]).toEqual({
      number: 2,
      state: 'open',
      title: 't2',
      labels: ['prerelease'],
      body: '',
      node_id: 'I_2',
    });
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.example/repos/o/r/issues?labels=prerelease&state=all&per_page=100&page=1',
      'https://api.example/repos/o/r/issues?labels=prerelease&state=all&per_page=100&page=2',
    ]);
    expect(calls[0].headers.authorization).toBe('Bearer tok-secret');
  });

  test('a non-2xx response fails with the route and GitHub message, never the token', async () => {
    const { gh } = client(() => ({
      status: 404,
      json: { message: 'Not Found' },
    }));
    const err = await gh.comment(5, 'hi').catch((e: Error) => e);
    expect(String(err)).toMatch(
      /POST \/repos\/o\/r\/issues\/5\/comments failed: 404 Not Found: Not Found/,
    );
    expect(String(err)).not.toContain('tok-secret');
    expect(JSON.stringify(gh)).not.toContain('tok-secret');
  });

  test('ensureLabels creates only the missing labels, with fixed colours', async () => {
    const { gh, calls } = client(({ method }) =>
      method === 'GET'
        ? { json: [{ name: 'privacy', color: '000000' }] }
        : { json: {} },
    );
    await gh.ensureLabels(['privacy', 'prerelease:functional', 'privacy']);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: 'https://api.example/repos/o/r/labels',
        body: { name: 'prerelease:functional', color: 'c5def5' },
      }),
    ]);
  });

  test('pinIssue uses the GraphQL endpoint next to the REST API', async () => {
    const { gh, calls } = client(() => ({
      json: { data: { pinIssue: { issue: { number: 1 } } } },
    }));
    await gh.pinIssue('I_1');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.example/graphql',
      body: { variables: { id: 'I_1' } },
    });
    expect((calls[0].body as { query: string }).query).toMatch(
      /pinIssue\(input: \{ issueId: \$id \}\)/,
    );
  });

  test('GraphQL errors fail the call', async () => {
    const { gh } = client(() => ({
      json: { errors: [{ message: 'too many pins' }] },
    }));
    await expect(gh.pinIssue('I_1')).rejects.toThrow(/too many pins/);
  });

  test('updateIssue and createIssue send the fields given', async () => {
    const { gh, calls } = client(({ method }) =>
      method === 'POST'
        ? { json: { number: 9, node_id: 'I_9' } }
        : { json: {} },
    );
    expect(
      await gh.createIssue({ title: 't', body: 'b', labels: ['prerelease'] }),
    ).toEqual({
      number: 9,
      node_id: 'I_9',
    });
    await gh.updateIssue(9, { state: 'closed', state_reason: 'completed' });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      [
        'POST',
        'https://api.example/repos/o/r/issues',
        { title: 't', body: 'b', labels: ['prerelease'] },
      ],
      [
        'PATCH',
        'https://api.example/repos/o/r/issues/9',
        { state: 'closed', state_reason: 'completed' },
      ],
    ]);
  });
});

describe('the per-run issue cap', () => {
  const targets = [
    'chrome-canary',
    'chrome-dev',
    'firefox-nightly',
    'safari-tp',
  ];
  /** Each target with the given checks failing on it, all others passing. */
  const fails: Record<string, Array<[string, CheckKind]>> = {
    'chrome-canary': [
      ['a-check', 'functional'],
      ['b-check', 'functional'],
      ['c-check', 'functional'],
    ],
    'chrome-dev': [['c-check', 'functional']],
    'firefox-nightly': [
      ['b-check', 'functional'],
      ['c-check', 'functional'],
    ],
    'safari-tp': [['mask-check', 'privacy']],
  };
  /** The four checks failing, or only those in `failed`, the rest passing. */
  const four = (failed?: string[]): TargetResult[] =>
    targets.map((id) => {
      const r = passing(id, 'other-check');
      for (const [checkId, kind] of fails[id]) {
        r.checks[checkId] =
          !failed || failed.includes(checkId)
            ? {
                kind,
                status: 'fail',
                attempts: 3,
                message: `${checkId} broke`,
              }
            : { kind, status: 'pass', attempts: 1 };
      }
      return r;
    });
  const opts = (gh: ReturnType<typeof fakeGitHub>, r: RunMeta) => ({
    gh,
    results: four(),
    expected: targets,
    apply: true,
    run: r,
    issueCap: 2,
  });
  const perCheck = (gh: ReturnType<typeof fakeGitHub>) =>
    gh.issues.filter((i) => parseMarkers(i.body).key);

  test('opens the first two by priority, says so in each body, and lists the rest in the status', async () => {
    const gh = fakeGitHub();
    await reconcile(opts(gh, runN(1)));
    expect(perCheck(gh).map((i) => parseMarkers(i.body).key)).toEqual([
      'c-check:functional',
      'mask-check:privacy',
    ]);
    for (const i of perCheck(gh)) {
      expect(countLine(i.body)).toBe(
        '**This run found 4 failing checks.** 2 were held back by the per-run cap of 2.',
      );
    }
    const [status] = statusIssues(gh);
    expect(status.body).toContain(
      '### Held back by the per-run issue cap (2)\n\n' +
        '- `b-check:functional` on chromium, gecko, 2 targets\n' +
        '- `a-check:functional` on chromium, 1 target\n',
    );
  });

  test('a second pass on the same results writes nothing', async () => {
    const gh = fakeGitHub();
    await reconcile(opts(gh, runN(1)));
    const writes = {
      created: gh.created.length,
      updates: gh.updates.length,
      comments: gh.comments.length,
    };
    await reconcile(opts(gh, runN(1)));
    expect({
      created: gh.created.length,
      updates: gh.updates.length,
      comments: gh.comments.length,
    }).toEqual(writes);
  });

  test('a later attempt of the same run with other results opens no more than the cap', async () => {
    const gh = fakeGitHub();
    await reconcile(opts(gh, runN(1)));
    // Re-running failed jobs: the two opened checks now pass everywhere.
    await reconcile({
      ...opts(gh, runN(1)),
      results: four(['a-check', 'b-check']),
    });
    expect(
      perCheck(gh).map((i) => [parseMarkers(i.body).key, i.state]),
    ).toEqual([
      ['c-check:functional', 'closed'],
      ['mask-check:privacy', 'closed'],
    ]);
    expect(statusIssues(gh)[0].body).toContain(
      '### Held back by the per-run issue cap (2)\n\n' +
        '- `b-check:functional` on chromium, gecko, 2 targets\n' +
        '- `a-check:functional` on chromium, 1 target\n',
    );
    // The next run starts with every slot free.
    await reconcile({
      ...opts(gh, runN(2)),
      results: four(['a-check', 'b-check']),
    });
    expect(perCheck(gh)).toHaveLength(4);
  });

  test('a local run, without GITHUB_RUN_ID, neither stamps nor matches the notified marker', async () => {
    const local = runMetaFromEnv(four(), {});
    expect(local.runId).toBeUndefined();
    expect(local.runUrl).toBe('https://github.com/rrweb-io/rrweb/actions');
    // An issue an earlier local run stamped with that same constant URL.
    const gh = fakeGitHub([
      {
        body: `<!-- prerelease:key=c-check:functional -->\n<!-- prerelease:engines=chromium,gecko -->\n<!-- prerelease:targets=chrome-canary,chrome-dev,firefox-nightly -->\n<!-- prerelease:notified=${local.runUrl} -->\n`,
      },
    ]);
    await reconcile(opts(gh, local));
    // c-check is only updated, and holds no slot: two more open.
    expect(gh.created.filter((i) => parseMarkers(i.body).key)).toHaveLength(2);
    for (const i of gh.created) {
      expect(parseMarkers(i.body).notified).toBeUndefined();
    }
  });

  test('a run in Actions stamps its run id', () => {
    const meta = runMetaFromEnv(four(), {
      GITHUB_RUN_ID: '42',
      GITHUB_REPOSITORY: 'o/r',
    });
    expect(meta).toMatchObject({
      runId: '42',
      runUrl: 'https://github.com/o/r/actions/runs/42',
    });
  });

  test('the next run opens the held-back ones and updates the rest', async () => {
    const gh = fakeGitHub();
    await reconcile(opts(gh, runN(1)));
    await reconcile(opts(gh, runN(2)));
    expect(perCheck(gh)).toHaveLength(4);
    for (const i of perCheck(gh)) {
      expect(countLine(i.body)).toBe('**This run found 4 failing checks.**');
    }
    expect(statusIssues(gh)[0].body).not.toContain('Held back');
  });

  test('a reopened body opens with the count', async () => {
    const gh = fakeGitHub();
    const fail = [failing('chrome-canary', 'css-nested-rules')];
    const pass = [passing('chrome-canary', 'css-nested-rules')];
    const o = { gh, expected: ['chrome-canary'], apply: true, issueCap: 5 };
    await reconcile({ ...o, results: fail, run: runN(1) });
    await reconcile({ ...o, results: pass, run: runN(2) });
    await reconcile({ ...o, results: fail, run: runN(3) });
    const [issue] = keyed(gh);
    expect(issue.state).toBe('open');
    expect(countLine(issue.body)).toBe('**This run found 1 failing check.**');
    expect(parseMarkers(issue.body).notified).toBe(runN(3).runUrl);
  });

  test('the run-broken body opens with the count', async () => {
    const gh = fakeGitHub();
    await reconcile({
      gh,
      results: massFailure(6),
      expected: ['chrome-canary'],
      apply: true,
      run,
      issueCap: 2,
    });
    const [broken] = gh.issues.filter((i) =>
      i.body.includes('<!-- prerelease:run-broken -->'),
    );
    expect(countLine(broken.body)).toBe('**This run found 6 failing checks.**');
  });
});

describe('the command line', () => {
  test('reads --issue-cap as a positive integer', () => {
    expect(parseCli(['--results', 'r', '--issue-cap', '5']).issueCap).toBe(5);
    expect(parseCli(['--results', 'r', '--issue-cap=12']).issueCap).toBe(12);
  });

  test('an absent or empty --issue-cap means no cap', () => {
    expect(parseCli(['--results', 'r']).issueCap).toBeUndefined();
    expect(parseCli(['--results', 'r', '--issue-cap', '']).issueCap).toBe(
      undefined,
    );
    expect(parseCli(['--results', 'r', '--issue-cap=']).issueCap).toBe(
      undefined,
    );
  });

  test.each(['0', '-1', 'abc', '2.5', '5x', '1e3', '99999999999999999999'])(
    'rejects --issue-cap=%s',
    (value) => {
      expect(() =>
        parseCli(['--results', 'r', `--issue-cap=${value}`]),
      ).toThrow(`--issue-cap must be a positive integer, not '${value}'`);
    },
  );

  test('a bad cap stops the report with an error', async () => {
    const script = fileURLToPath(
      new URL('../src/report/reconcile.ts', import.meta.url),
    );
    const err = await promisify(execFile)(process.execPath, [
      script,
      '--results',
      'results',
      '--issue-cap',
      '0',
    ]).then(
      () => undefined,
      (e: { code: number; stderr: string }) => e,
    );
    expect(err?.code).toBe(1);
    expect(err?.stderr).toContain(
      "--issue-cap must be a positive integer, not '0'",
    );
  });
});
