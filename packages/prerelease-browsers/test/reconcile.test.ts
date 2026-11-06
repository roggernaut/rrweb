import { fileURLToPath } from 'node:url';
import { readResults, type TargetResult } from '../src/node/results.ts';
import {
  GitHub,
  type IssueData,
  type IssuePatch,
  type NewIssue,
} from '../src/report/github.ts';
import { reconcile, type GitHubLike } from '../src/report/reconcile.ts';
import { parseMarkers, type RunMeta } from '../src/report/render.ts';
import { failing, incomplete, passing } from './helpers/results.ts';

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
  date: '2026-11-06',
  rrwebCommit: 'abc123',
};
const runN = (n: number): RunMeta => ({
  runUrl: `https://github.com/rrweb-io/rrweb/actions/runs/${n}`,
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
    title: '[pre-release] functional: css-nested-rules fails on chromium',
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
  expect(broken.title).toBe('[pre-release] Run broken: 6 checks failed');
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
