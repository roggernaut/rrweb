# Pre-release Browser Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scheduled GitHub workflow that records test pages with rrweb `main` on upcoming browser builds every two weeks and reports functional, performance and privacy failures as GitHub issues. The same checks also run on every pull request against today's main browsers, comparing the pull request's rrweb with the base branch's.

**Architecture:** A new private workspace package, `packages/prerelease-browsers`, holds everything. Checks run inside the page from one esbuild bundle and talk to Node through a small polling protocol. That protocol works the same over Playwright, Selenium and BrowserStack's iOS bridge. Each runner writes one results file per target. A final step turns all results into issue actions through pure functions, then applies them through a thin GitHub REST client.

**Tech Stack:** TypeScript run directly by Node 22.18 or later through built-in type stripping, Vitest 1.6, Playwright 1.61.1, `selenium-webdriver` 4, `@puppeteer/browsers` 2, esbuild 0.24.2, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-06-prerelease-browser-testing-design.md`

## Global Constraints

- Schedule: every two weeks, and runnable by hand through `workflow_dispatch`.
- A whole run finishes within 2 hours, retries included. Runners stop starting new work at a deadline 105 minutes after the run starts.
- At most 5 BrowserStack sessions at once. "Parallel limit reached" errors mean waiting, never failing.
- Manual runs skip BrowserStack unless the `browserstack` input is true.
- Alerts are GitHub issues in the repository the workflow runs in, and nowhere else.
- Privacy failures are public issues. Never route them to a security advisory.
- Performance fails when the upcoming median is more than 1.5 times the stable median on the same device, or when the median longest block is more than 1000 ms on any target.
- A functional or privacy check counts as failed only when it fails at least 2 of 3 attempts.
- rrweb under test is `main`, built in the run from `packages/rrweb`, and read from `packages/rrweb/dist/rrweb.umd.cjs` on disk. Package exports hide that file.
- Recording only. No replay checks, except using `rrweb.Replayer` in the page to verify what was recorded.
- The package is private, so it needs no changeset.
- Per-PR runs use stable Chrome, stable Edge, stable Firefox and Playwright's bundled WebKit, plus real Safari only when the pull request has the `safari` label. They run the focused set, once with the pull request's rrweb and once with the base branch's, on the same runner.
- A per-PR failure fails the job and never opens an issue. A check that also fails with the base branch's rrweb is a warning. Per-PR runs use no secrets and no BrowserStack.
- Node code uses only erasable TypeScript syntax: no enums, no namespaces, no parameter properties. Relative imports carry the `.ts` extension.
- Commit messages carry no `Co-Authored-By` or other Claude attribution lines.
- Write every file from this plan and the spec. Do not copy code from any other repository.

## Review Focus

1. **A browser that fails to launch.** It should be reported as a launch failure in the status issue. It must not become check failures, count toward the mass-failure share, or close any issue. Tests are in Task 13 and Task 14.
2. **A target whose results are missing or incomplete,** for example a cancelled job or a hit deadline. The run should show as incomplete, and no issue may auto-close for a check that didn't run on its failing targets. Test is in Task 14.
3. **Event JSON with emoji that crosses a read-chunk boundary.** It should come back byte-identical, because WebDriver replaces lone surrogates. Test is in Task 2.
4. **An inlined rrweb build or check bundle that contains `</script>`.** The composed page should still run both scripts. Test is in Task 1.
5. **The report step running twice on the same results,** for example after a re-run of the job. The second pass should open no new issues and only rewrite bodies. Test is in Task 14.

---

## File Structure

```text
packages/prerelease-browsers/
  package.json              private workspace package, scripts below
  tsconfig.json             noEmit, allowImportingTsExtensions, DOM + node libs
  vitest.config.ts          merges ../../vitest.config.ts
  README.md                 run one target locally, reproduce an issue, park a failure
  known-failures.json       parked failures, starts as []
  src/
    types.ts                shared by page and Node: CheckMeta, AttemptResult, PerfSample, Engine
    page/
      entry.ts              defines window.__prerelease (the protocol)
      harness.ts            CheckContext: record, replay, compareComputed, measure, canary
      registry.ts           every check, in one ordered list
      checks/css.ts  checks/builtins.ts  checks/dom.ts  checks/inputs.ts
      checks/media.ts  checks/privacy.ts  checks/perf.ts
    node/
      page-source.ts        buildPageBundle, readRrwebUmd, composePage
      drivers/types.ts      PageDriver, BrowserInfo
      drivers/playwright.ts
      drivers/selenium.ts
      driver-process.ts     start geckodriver / safaridriver and wait for /status
      fixture-server.ts     http server for needsHttp checks, two origins
      run-check.ts          runAttempt, runWithRetry, runScenario
      run-targets.ts        runTarget: all checks for one target, deadline, results file
      results.ts            TargetResult, CheckOutcome, read/write
      targets.ts            GitHub-runner target definitions
      install.ts            per-target browser install for GitHub runners
      browserstack.ts       catalogue resolution, caps, pool, backoff
      cli.ts                run-target and run-browserstack entry points
    report/
      compare.ts            performance pairing and limits
      failures.ts           collectFailures, known-failures parsing
      issues-plan.ts        planIssueActions
      render.ts             issue titles, bodies, markers, status body
      github.ts             REST + GraphQL client over fetch
      reconcile.ts          report entry point
      pr-summary.ts         per-PR verdict and job summary
  test/
    page-source.test.ts  protocol.test.ts  checks.chromium.test.ts
    retry.test.ts  run-target.test.ts  selenium.test.ts
    browserstack.test.ts  compare.test.ts  failures.test.ts
    issues-plan.test.ts  render.test.ts  reconcile.test.ts
    fixtures/browserstack-browsers.json  fixtures/results/*.json
.github/workflows/prerelease-browsers.yml
.github/workflows/prerelease-browsers-pr.yml
```

`src/page/**` runs only in browsers. `src/node/**` and `src/report/**` run only in Node. `src/types.ts` holds types only, so both sides can import it.

---

### Task 1: Package scaffold and page composition

**Files:**

- Create: `packages/prerelease-browsers/package.json`, `tsconfig.json`, `vitest.config.ts`, `known-failures.json`, `src/types.ts`, `src/node/page-source.ts`, `src/page/entry.ts` (stub that defines `window.__prerelease = { version: 1 }`)
- Test: `packages/prerelease-browsers/test/page-source.test.ts`

**Interfaces:**

- Produces, in `src/types.ts`:

```ts
export type CheckKind = 'functional' | 'privacy' | 'performance';
export type Engine = 'chromium' | 'gecko' | 'webkit';
export type Tier = 'focused' | 'full';
export interface CheckMeta {
  id: string; // kebab-case, stable forever: it is the issue identity
  kind: CheckKind;
  tier: Tier;
  needsHttp?: boolean;
  startDuringLoad?: boolean;
  head?: string; // static markup placed in <head> before the scripts
  compare?: Array<'durationMs' | 'maxBlockMs' | 'heapDeltaBytes'>; // performance only, default ['durationMs']
}
export interface PerfSample {
  durationMs: number;
  maxBlockMs: number;
  heapDeltaBytes?: number;
}
export interface AttemptResult {
  ok: boolean;
  message?: string;
  skipped?: string; // reason; a skipped attempt is neither pass nor fail
  events?: unknown[];
  sample?: PerfSample;
}
export interface RunOptions {
  disableMasking?: boolean;
  scale?: number;
}
```

- Produces, in `src/node/page-source.ts`:
  - `buildPageBundle(): Promise<string>` bundles `src/page/entry.ts` with esbuild as an IIFE, `target: 'es2020'`, in memory, no sourcemap. Cache the result in a module variable.
  - `readRrwebUmd(distDir = process.env.RRWEB_DIST ?? <repo>/packages/rrweb/dist): string` reads `rrweb.umd.cjs`. It throws `Error('rrweb is not built: run yarn turbo run prepublish --filter=rrweb')` when the file is missing.
  - `composePage(meta: CheckMeta, pageBundle: string, rrwebUmd: string): string`
  - `escapeInlineScript(source: string): string` replaces every `</script` with `<\/script`, case-insensitively.

`composePage` emits exactly this order: doctype, `<meta charset="utf-8">`, `<title>rrweb prerelease: ${id}</title>`, `meta.head`, the page bundle script, `<script>__prerelease.beforeRrweb(${JSON.stringify(id)})</script>`, the rrweb script and, when `startDuringLoad` is set, `<script>__prerelease.start(${JSON.stringify(id)}, {})</script>`. It ends with `<body></body>`.

`package.json`:

- name `@rrweb/prerelease-browsers`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=22.18" }`
- scripts: `"test": "vitest run"`, `"check-types": "tsc -noEmit"`, `"run-target": "node src/node/cli.ts run-target"`, `"run-browserstack": "node src/node/cli.ts run-browserstack"`, `"report": "node src/report/reconcile.ts"`
- devDependencies: `rrweb` and `@rrweb/types` at `^2.2.0` (workspace), `playwright` `1.61.1`, `esbuild` `0.24.2`, `vitest` `^1.6.1`, `@types/node` `^18.15.11`, `typescript` `^5.4.5`. Tasks 9 and 10 add the rest.

`tsconfig.json` is standalone: `target` and `lib` ES2022 + DOM + DOM.Iterable, `module` and `moduleResolution` NodeNext, `allowImportingTsExtensions`, `noEmit`, `strict`, `types: ["node"]`, `include: ["src", "test"]`. Commit whatever `references` the root `references:update` script adds.

- [ ] **Step 1: Write the failing tests**

```ts
import {
  composePage,
  escapeInlineScript,
  readRrwebUmd,
} from '../src/node/page-source.ts';
const meta = { id: 'x-check', kind: 'functional', tier: 'full' } as const;

test('scripts appear in protocol order', () => {
  const html = composePage(
    { ...meta, head: '<style>.a{}</style>' },
    'BUNDLE',
    'RRWEB',
  );
  const order = [
    '<style>.a{}</style>',
    'BUNDLE',
    '__prerelease.beforeRrweb("x-check")',
    'RRWEB',
  ];
  const at = order.map((s) => html.indexOf(s));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(html).not.toContain('__prerelease.start(');
});
test('startDuringLoad adds the start call after rrweb', () => {
  const html = composePage({ ...meta, startDuringLoad: true }, 'B', 'R');
  expect(html.indexOf('__prerelease.start("x-check", {})')).toBeGreaterThan(
    html.indexOf('R'),
  );
});
test('inlined sources cannot close their script tag', () => {
  expect(escapeInlineScript('a="</script>";b="</SCRIPT >"')).toBe(
    'a="<\\/script>";b="<\\/SCRIPT >"',
  );
  expect(composePage(meta, 'x="</script>"', 'y')).not.toMatch(/x="<\/script>"/);
});
test('missing rrweb build gives the build command', () => {
  expect(() => readRrwebUmd('/nonexistent')).toThrow(
    'yarn turbo run prepublish --filter=rrweb',
  );
});
```

- [ ] **Step 2:** Run `yarn workspace @rrweb/prerelease-browsers vitest run test/page-source.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Create the scaffold files and implement `page-source.ts` as specified. Run `yarn install` at the root.
- [ ] **Step 4:** Run the same command. Expected: 4 passed. Then run `yarn workspace @rrweb/prerelease-browsers check-types`. Expected: no errors.
- [ ] **Step 5: Commit**

```bash
git add packages/prerelease-browsers yarn.lock
git commit -m "feat(prerelease): scaffold package and page composition"
```

---

### Task 2: In-page protocol, harness, Playwright driver and the first check

**Files:**

- Create: `src/page/harness.ts`, `src/page/registry.ts`, `src/page/checks/dom.ts` (first check only), `src/node/drivers/types.ts`, `src/node/drivers/playwright.ts`, `src/node/run-check.ts` (`runAttempt` only)
- Modify: `src/page/entry.ts`
- Test: `test/protocol.test.ts`

**Interfaces:**

- Consumes: Task 1 types, `composePage`, `buildPageBundle`, `readRrwebUmd`.
- Produces, in-page, in `src/page/harness.ts`:

```ts
export interface Recording {
  stop(): Promise<eventWithTime[]>;
} // waits 2 animation frames + 50 ms, then stops and returns events
export interface CheckContext {
  rrweb: typeof import('rrweb'); // window.rrweb
  options: Required<RunOptions>; // defaults: disableMasking false, scale 1
  record(options?: recordOptions<eventWithTime>): Recording;
  replay(events: eventWithTime[]): Promise<Document>; // Replayer into a hidden container, played to the end
  compareComputed(
    events: eventWithTime[],
    probes: Array<{ selector: string; props: string[]; shadowHost?: string }>,
  ): Promise<AttemptResult>;
  measure<T>(
    fn: () => T | Promise<T>,
  ): Promise<{ value: T; durationMs: number; maxBlockMs: number }>;
  heapBytes(): number | undefined; // performance.memory?.usedJSHeapSize
  canary(name: string, format?: 'text' | 'digits' | 'email'): string;
  control(name: string): string;
  assertPrivate(
    events: eventWithTime[],
    canaries: string[],
    controls: string[],
  ): AttemptResult;
  nextFrame(): Promise<void>;
  sleep(ms: number): Promise<void>;
}
export interface CheckDefinition extends CheckMeta {
  beforeRrweb?(): void;
  run(ctx: CheckContext): Promise<AttemptResult>;
}
```

- `canary` returns `RRCANARY${NAME}${6 random digits}` for text. For digits it returns 16 random digits, and for email `rrcanary${6 digits}@example.com`. Random per attempt, so no canary can appear in the bundle source.
- `control` returns `RRPUBLIC${NAME}${6 random digits}`.
- `assertPrivate` searches `JSON.stringify(events)`. Messages are `privacy leak: <canary>` and `public control missing: <control>`. It reports the first problem, and `ok` is true only with no leak and every control present.
- `record()` with `options.disableMasking` overrides the caller's options. It sets `maskAllInputs: false`, `maskInputOptions: { password: false }`, and `maskTextClass` and `blockClass` to `'__prerelease_none__'`. It also drops `maskTextSelector`, `blockSelector` and `maskInputFn`.
- `measure` runs a `MessageChannel` heartbeat. It yields one tick, runs `fn`, awaits 2 frames plus 100 ms, and stops. `maxBlockMs` is the largest gap between heartbeat ticks.
- Produces, in-page, `window.__prerelease` in `entry.ts`:

```ts
{
  version: 1,
  list(): CheckMeta[];
  beforeRrweb(id: string): void;
  start(id: string, options: RunOptions): void;   // returns at once; runs the check in the background
  poll(): { state: 'idle' | 'running' | 'done' | 'error'; length?: number; error?: string };
  read(offset: number): string;                   // at most 200_000 UTF-16 units of JSON.stringify(AttemptResult)
}
```

`read` never ends a chunk on a high surrogate. If the last unit of a chunk is in 0xD800 to 0xDBFF, it returns one unit less. `start` wraps the check so that a thrown error becomes `state: 'error'` with the message, and listens for `error` and `unhandledrejection`. Any page error during a run turns the result into `ok: false` with `page error: <message>`.

- Produces, in `src/node/drivers/types.ts`:

```ts
export interface BrowserInfo {
  browserName: string;
  browserVersion: string;
  platform: string;
  device?: string;
  userAgent: string;
}
export interface PageDriver {
  readonly canReachLocalhost: boolean;
  loadHtml(html: string): Promise<void>;
  open(url: string): Promise<void>;
  evaluate<T>(expression: string): Promise<T>; // a JS expression; JSON-serializable result
  describe(): Promise<BrowserInfo>;
  sessionUrl?(): Promise<string | undefined>;
  markSession?(passed: boolean, reason: string): Promise<void>;
  close(): Promise<void>;
}
```

- Produces, in `src/node/drivers/playwright.ts`:
  - `launchPlaywright(opts: { engine: Engine; channel?: string; executablePath?: string; playwrightModule?: string; args?: string[] }): Promise<PageDriver>`
  - `playwrightDriver(page: Page, extra: { canReachLocalhost: boolean; describe?: () => Promise<Partial<BrowserInfo>>; close: () => Promise<void>; singleTab?: boolean }): PageDriver`
  - `loadHtml` is `page.setContent(html, { waitUntil: 'load' })`. `playwrightModule` is a path to import Playwright from instead of the package's own, which Task 10 uses for `playwright@next`.
- Produces, in `src/node/run-check.ts`:
  - `runAttempt(driver: PageDriver, meta: CheckMeta, src: { bundle: string; rrweb: string; httpOrigin?: string }, opts: RunOptions & { timeoutMs: number }): Promise<AttemptResult>`
  - It loads the page, through `open(httpOrigin + '/check/' + id)` when `needsHttp`, else `loadHtml(composePage(...))`. Unless `startDuringLoad` is set, it calls `start`, then polls every 250 ms until `done` or `error` or the timeout. It reads chunks until `length`, then parses.
  - A timeout returns `{ ok: false, message: 'timed out after <n> ms' }`.
  - A `needsHttp` check without `httpOrigin` or on a driver with `canReachLocalhost: false` returns `{ ok: true, skipped: 'needs http' }`.

First check in `checks/dom.ts`: `snapshot-basic`, functional, focused. It builds `<main><h1>hello</h1><ul><li>1</li></ul></main>`, records, appends one `<li>`, and stops. It asserts that a type 2 (FullSnapshot) event exists and that a type 3 event with source 0 (Mutation) has one add. It then asserts the replayed document's `li` count is 2.

- [ ] **Step 1: Write the failing tests**

```ts
// test/protocol.test.ts, using launchPlaywright({ engine: 'chromium' })
test('snapshot-basic passes on chromium', async () => {
  const r = await runAttempt(driver, meta('snapshot-basic'), src, {
    timeoutMs: 30_000,
  });
  expect(r).toMatchObject({ ok: true });
  expect(r.events!.some((e: any) => e.type === 2)).toBe(true);
});
test('chunked read survives a surrogate pair on the boundary', async () => {
  // test-only check registered when window.__prerelease_test is set: returns
  // { ok: true, message: 'a'.repeat(199_999 - '{"ok":true,"message":"'.length) + '😀' + 'z' }
  const r = await runAttempt(driver, meta('test-surrogate-boundary'), src, {
    timeoutMs: 10_000,
  });
  expect(r.message!.endsWith('😀z')).toBe(true);
});
test('a thrown check reports an error, not a hang', async () => {
  const r = await runAttempt(driver, meta('test-throws'), src, {
    timeoutMs: 10_000,
  });
  expect(r).toMatchObject({
    ok: false,
    message: expect.stringContaining('boom'),
  });
});
test('a hung check times out', async () => {
  const r = await runAttempt(driver, meta('test-hangs'), src, {
    timeoutMs: 2_000,
  });
  expect(r.message).toBe('timed out after 2000 ms');
});
```

Register the three `test-*` checks in `registry.ts` only when `window.__prerelease_test === true`. Tests set it through `meta.head = '<script>window.__prerelease_test=true</script>'`.

- [ ] **Step 2:** Run `yarn workspace @rrweb/prerelease-browsers vitest run test/protocol.test.ts`. Expected: FAIL. If chromium is missing, run `npx playwright install chromium` first.
- [ ] **Step 3:** Implement `entry.ts`, `harness.ts`, `registry.ts`, the first check, both driver files and `runAttempt`.
- [ ] **Step 4:** Run the same command. Expected: 4 passed.
- [ ] **Step 5: Commit**

```bash
git add packages/prerelease-browsers
git commit -m "feat(prerelease): in-page protocol, harness and Playwright driver"
```

---

### Task 3: Retry, results files and running a target locally

**Files:**

- Create: `src/node/results.ts`, `src/node/run-targets.ts`, `src/node/targets.ts` (local entries only), `src/node/cli.ts`
- Modify: `src/node/run-check.ts` (add `runWithRetry`)
- Test: `test/retry.test.ts`, `test/run-target.test.ts`

**Interfaces:**

- Produces, in `src/node/results.ts`:

```ts
export type CheckStatus = 'pass' | 'fail' | 'flaky' | 'skipped' | 'not-run';
export interface CheckOutcome {
  kind: CheckKind;
  status: CheckStatus;
  message?: string; // from the last failing attempt
  attempts: number;
  samples?: PerfSample[]; // performance only
  eventsFile?: string; // relative to the results dir, last failing attempt's events
}
export interface TargetResult {
  schema: 1;
  targetId: string;
  engine: Engine;
  channel: 'upcoming' | 'stable';
  pairGroup?: string;
  perf: 'compare' | 'ceiling-only' | 'none';
  ceilingMs: number; // default 1000
  browser?: BrowserInfo;
  launch: { ok: true } | { ok: false; error: string };
  rrwebCommit: string;
  startedAt: string;
  finishedAt: string;
  incomplete: boolean; // true when the deadline stopped work
  sessionUrl?: string;
  checks: Record<string, CheckOutcome>;
}
export function writeResult(dir: string, r: TargetResult): Promise<void>; // <dir>/<targetId>.json
export function readResults(dir: string): Promise<TargetResult[]>;
```

- Produces, in `src/node/targets.ts`:

```ts
export interface TargetDefinition {
  id: string;
  engine: Engine;
  channel: 'upcoming' | 'stable';
  pairGroup?: string;
  where:
    | 'local'
    | 'github-linux'
    | 'github-macos'
    | 'github-android'
    | 'browserstack';
  checks: 'all' | 'focused' | 'functional-privacy';
  perf: 'compare' | 'ceiling-only' | 'none';
  perfSamples: number; // 5 on GitHub, 3 on BrowserStack
  timeScale: number; // multiplies every timeout: 1 GitHub, 5 BrowserStack
  ceilingMs?: number;
  connect(): Promise<PageDriver>;
}
export const localTargets: TargetDefinition[]; // 'local-chromium', 'local-firefox', 'local-webkit': bundled Playwright engines, checks 'all', perf 'ceiling-only'
export function findTarget(id: string): TargetDefinition; // throws listing known ids
```

- Produces, in `src/node/run-check.ts`, `runWithRetry(attempt: () => Promise<AttemptResult>): Promise<{ status: CheckStatus; attempts: AttemptResult[] }>`:
  - First attempt passes or is skipped: return `pass` or `skipped` after 1 attempt.
  - Fail then fail: `fail` after 2 attempts.
  - Fail, pass, fail: `fail` after 3.
  - Fail, pass, pass: `flaky` after 3.
- Produces, in `src/node/run-targets.ts`, `runTarget(t: TargetDefinition, opts: { resultsDir: string; deadline: Date; only?: string[]; rrwebCommit: string }): Promise<TargetResult>`. Behaviour:
  - `connect()` failure becomes `launch: { ok: false, error }` with no checks.
  - The check set follows `t.checks`: `focused` keeps tier `focused`, and `functional-privacy` drops performance.
  - Performance is skipped entirely when `t.perf === 'none'`.
  - Performance checks call `runScenario`, from Task 8. Until then, treat them as `not-run`.
  - Each check is a fresh `runAttempt` with `timeoutMs` of 60,000 for functional and privacy and 180,000 for performance, multiplied by `timeScale`.
  - Once the deadline passes, every remaining check is `not-run` and `incomplete` is true.
  - Events of the last failing attempt are written to `<resultsDir>/<targetId>/<checkId>.events.json`.
  - It calls `markSession` when the driver has it and records `sessionUrl`.
  - It always closes the driver.
- `cli.ts run-target --target <id> [--check <id>]... [--results <dir>] [--deadline <iso>]`. Defaults are `results` and now plus 105 minutes. `rrwebCommit` comes from `git rev-parse HEAD`. It prints one summary line per check and exits 0 even when checks fail. Only crashes exit non-zero.

- [ ] **Step 1: Write the failing tests**

```ts
// test/retry.test.ts
const seq = (...oks: boolean[]) => {
  let i = 0;
  return async () => ({ ok: oks[i++] });
};
test.each([
  [[true], 'pass', 1],
  [[false, false], 'fail', 2],
  [[false, true, false], 'fail', 3],
  [[false, true, true], 'flaky', 3],
])('%j gives %s after %i attempts', async (oks, status, n) => {
  const r = await runWithRetry(seq(...oks));
  expect(r.status).toBe(status);
  expect(r.attempts).toHaveLength(n);
});
// test/run-target.test.ts
test('past the deadline every check is not-run and the result is incomplete', async () => {
  const r = await runTarget(findTarget('local-chromium'), {
    resultsDir: tmp,
    deadline: new Date(0),
    rrwebCommit: 'abc',
  });
  expect(r.incomplete).toBe(true);
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
});
```

- [ ] **Step 2:** Run `yarn workspace @rrweb/prerelease-browsers vitest run test/retry.test.ts test/run-target.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run the same command. Expected: all pass. Then run `yarn workspace @rrweb/prerelease-browsers run-target --target local-chromium`. Expected: `snapshot-basic pass` and a file `results/local-chromium.json`.
- [ ] **Step 5:** Commit with message `feat(prerelease): retry rule, results files and run-target`.

---

### Tasks 4 to 7: The checks

Every check below goes in its area file and is added to `registry.ts` in this order. Every assertion compares against what the live page actually holds, never a value taken from Chrome, so each check holds on every engine.

These rules apply to every check task:

- **One shared test file.** `test/checks.chromium.test.ts` runs every functional and privacy check in the registry on `local-chromium` and expects `ok: true`. For privacy checks it also runs each with `{ disableMasking: true }` and expects `ok: false` with a message starting `privacy leak` or `public control missing`. A check task's first step adds that check's ids to the expected-id list in this file, so the test fails until the check exists.
- **A check must pass on stable Chromium today.** If rrweb `main` does not handle a case today, that is a current rrweb gap, not a pre-release regression. Leave the check out and list it in the pull request description.
- **Each check task follows the same steps.** Add the ids to the test, run `yarn workspace @rrweb/prerelease-browsers vitest run test/checks.chromium.test.ts` and expect FAIL. Implement the checks, run again and expect PASS. Then run `run-target --target local-firefox` and `local-webkit` and note any failures in the commit message body, then commit.

Event numbers come from `@rrweb/types`. Event types are FullSnapshot 2 and IncrementalSnapshot 3. Sources are Mutation 0, Input 5, MediaInteraction 7, StyleSheetRule 8, CanvasMutation 9, Selection 14, AdoptedStyleSheet 15 and CustomElement 16. Import the enums with `import type`, and use numeric literals at runtime with a comment naming each one.

### Task 4: CSS capture checks

**Files:** Modify `src/page/checks/css.ts` and `src/page/registry.ts`. Test: `test/checks.chromium.test.ts`.

**Interfaces:** Each check uses `ctx.compareComputed(events, probes)`. That helper replays the events and compares `getComputedStyle` of each probe's selector, live against replayed, for the listed properties. Its message lists every mismatch as `selector prop: live "<a>" replay "<b>"`.

| id                            | tier    | page                                                                                                                         | probes                                                               |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `css-shorthand-roundtrip`     | focused | `.box{background:#c00 url(data:image/gif;base64,R0lGODlhAQABAAAAACw=) no-repeat;margin:1px 2px}`                             | `.box`: background-color, background-repeat, margin-left, margin-top |
| `css-selector-colon-escape`   | full    | `.a\:b{color:rgb(0,128,0)}` with `class="a:b"`                                                                               | `.a\:b`: color                                                       |
| `css-early-linked-stylesheet` | full    | `needsHttp`, `startDuringLoad`, head links `/assets/slow.css`, served after a 500 ms delay with `#early{color:rgb(0,0,255)}` | `#early`: color                                                      |
| `css-grid-template-areas`     | full    | `.g{display:grid;grid-template-areas:"a b" "c d"}`                                                                           | `.g`: grid-template-areas                                            |
| `css-adopted-stylesheets`     | focused | document sheet `.ad{color:rgb(1,2,3)}` via `replaceSync`, plus a shadow root with its own adopted sheet                      | `.ad`: color, and the shadow probe: color                            |
| `css-insert-rule`             | full    | after `record()`, `sheet.insertRule('.late{color:rgb(4,5,6)}')`                                                              | `.late`: color, plus a StyleSheetRule event exists                   |
| `css-nested-rules`            | full    | `.n{color:rgb(7,8,9); & .c{color:rgb(10,11,12)}}`                                                                            | `.n .c`: color                                                       |

The fixture server for `css-early-linked-stylesheet` arrives in Task 5. Until then the check returns `skipped: 'needs http'`, which the Chromium test accepts for `needsHttp` checks only.

Commit message: `feat(prerelease): CSS capture checks`.

### Task 5: Built-in API and DOM checks, plus the fixture server

**Files:** Modify `src/page/checks/builtins.ts`, `src/page/checks/dom.ts` and `src/page/registry.ts`. Create `src/node/fixture-server.ts`. Test: `test/checks.chromium.test.ts`.

**Interfaces:**

- Produces `startFixtureServer(src: { bundle: string; rrweb: string }): Promise<{ origin: string; crossOrigin: string; close(): Promise<void> }>`. It listens on two ports at 127.0.0.1. Ports come from `PRERELEASE_HTTP_PORT` and `PRERELEASE_HTTP_PORT + 1`, default 8123, so that `adb reverse` can map them. It serves:
  - `GET /check/:id`: `composePage` for that check.
  - `GET /assets/slow.css`: `#early{color:rgb(0,0,255)}` after 500 ms.
  - `GET /frame/:id` on the cross origin: a composed page whose rrweb runs `record({ recordCrossOriginIframes: true, emit(){} })` on load and adds a `<p id="child">` with a control string from the query.
- `runTarget` starts the server when any selected check `needsHttp` and the driver `canReachLocalhost`, and passes `httpOrigin`.
- The Chromium test now runs with the server, so `css-early-linked-stylesheet` must pass, not skip.

| id                          | tier    | before rrweb                                                                                                                                            | assertion                                                                                                                                                               |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patched-mutation-observer` | focused | replace `window.MutationObserver` with a class whose constructor throws, as in `packages/rrweb/test/html/monkey-patched-mutation.html`                  | appending 3 `li` gives Mutation events with 3 adds in total                                                                                                             |
| `tainted-input-getters`     | full    | redefine `HTMLInputElement.prototype.value` with a getter that returns `undefined`, the case [#1950](https://github.com/rrweb-io/rrweb/pull/1950) fixed | typing `abc` gives an Input event with text `abc`                                                                                                                       |
| `missing-webgl-types`       | full    | `delete window.WebGL2RenderingContext; delete window.WebGLRenderingContext`                                                                             | `record({ recordCanvas: true })` gives a FullSnapshot and no page error                                                                                                 |
| `missing-css-grouping-rule` | full    | `delete window.CSSGroupingRule`                                                                                                                         | a page with `@media screen{.m{color:red}}` and an `insertRule` inside it gives a FullSnapshot, a StyleSheetRule event and no page error                                 |
| `shadow-dom-open`           | focused | none                                                                                                                                                    | appending into an open shadow root gives a Mutation event, and the replay shows the text inside the shadow root                                                         |
| `custom-elements`           | full    | none                                                                                                                                                    | defining `x-widget` after `record()` gives a CustomElement event, and the replay holds its rendered child text                                                          |
| `iframe-same-origin`        | focused | none                                                                                                                                                    | a `srcdoc` iframe whose text changes after `record()` shows the new text inside the replayed iframe                                                                     |
| `iframe-cross-origin`       | full    | `needsHttp`                                                                                                                                             | the parent records with `recordCrossOriginIframes: true` and an iframe at `crossOrigin + /frame/...`. The parent's events contain the child's control string within 5 s |
| `dialog-top-layer`          | full    | none                                                                                                                                                    | `showModal()` after `record()` gives a Mutation event setting attribute `open`                                                                                          |

Commit message: `feat(prerelease): built-in API and DOM checks with fixture server`.

### Task 6: Input, media and node-order checks

**Files:** Modify `src/page/checks/inputs.ts`, `src/page/checks/media.ts`, `src/page/checks/dom.ts` and `src/page/registry.ts`. Test: `test/checks.chromium.test.ts`.

| id                 | tier    | assertion                                                                                                                                                                                                                                                                            |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `input-types`      | focused | For each of text, email, tel, url, search, number, range, date, time, datetime-local, month, week and color, set a valid value and dispatch `input`. Each element gets an Input event whose text equals its live `.value`. A type the browser falls back to `text` for still counts. |
| `checkbox-radio`   | full    | Clicking each gives an Input event with `isChecked: true`.                                                                                                                                                                                                                           |
| `select`           | full    | Changing the selected option gives an Input event with the option's value.                                                                                                                                                                                                           |
| `contenteditable`  | full    | Changing a text node inside `contenteditable` gives a Mutation event with a text change.                                                                                                                                                                                             |
| `selection`        | full    | Selecting a range across two paragraphs gives a Selection event.                                                                                                                                                                                                                     |
| `canvas-2d`        | focused | With `recordCanvas: true`, `fillRect` gives a CanvasMutation event.                                                                                                                                                                                                                  |
| `canvas-webgl`     | full    | With `recordCanvas: true`, a WebGL clear gives a CanvasMutation event. Returns `skipped: 'no webgl'` when `getContext('webgl')` is null.                                                                                                                                             |
| `canvas-sampled`   | full    | With `recordCanvas: true` and `sampling: { canvas: 2 }`, drawing every frame for 1500 ms gives at least one CanvasMutation event.                                                                                                                                                    |
| `media-play-pause` | full    | A muted `<audio>` with a generated 1 s silent WAV data URL gets `play()` then `pause()`, giving MediaInteraction events of type 0 and 1. Returns `skipped: 'play rejected'` if `play()` rejects.                                                                                     |
| `node-order-burst` | focused | Seeded random insertion of 500 nested nodes across 10 microtasks, with stable ids. The replayed body's sequence of `tagName#id` equals the live one ([#1690](https://github.com/rrweb-io/rrweb/issues/1690)).                                                                        |

Commit message: `feat(prerelease): input, media and node-order checks`.

### Task 7: Privacy checks

**Files:** Modify `src/page/checks/privacy.ts` and `src/page/registry.ts`. Test: `test/checks.chromium.test.ts`, whose privacy branch with `disableMasking` was described above.

Every privacy check is tier `focused`. Each one plants at least one canary and one control in a nearby unmasked element, then ends with `ctx.assertPrivate(events, canaries, controls)`. Each check also changes something after the first snapshot, so both the snapshot and mutation paths are covered.

| id                                  | record options                                 | where the canaries go                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `privacy-mask-all-inputs`           | `maskAllInputs: true`                          | values typed into text, email and tel inputs, plus a textarea                                                                                                                                                                                                                                                                                                                                                   |
| `privacy-mask-text-class`           | `maskTextClass: 'rr-mask'`                     | text of `p.rr-mask` and of a `span` nested inside it                                                                                                                                                                                                                                                                                                                                                            |
| `privacy-mask-text-selector`        | `maskTextSelector: '[data-secret]'`            | text of `[data-secret]`                                                                                                                                                                                                                                                                                                                                                                                         |
| `privacy-block-class`               | `blockClass: 'rr-block'`                       | text and an input value inside `div.rr-block`                                                                                                                                                                                                                                                                                                                                                                   |
| `privacy-block-selector`            | `blockSelector: '#blocked'`                    | text inside `#blocked`                                                                                                                                                                                                                                                                                                                                                                                          |
| `privacy-password-default`          | defaults                                       | a password input value, typed and set as an attribute                                                                                                                                                                                                                                                                                                                                                           |
| `privacy-mask-input-options`        | `maskInputOptions: { email: true, tel: true }` | email (email format) and tel (digits format) values                                                                                                                                                                                                                                                                                                                                                             |
| `privacy-mutation-after-snapshot`   | `maskTextClass: 'rr-mask'`                     | the masked text replaced after `record()`, plus a new masked node appended                                                                                                                                                                                                                                                                                                                                      |
| `privacy-attribute-mutation`        | `maskAllInputs: true`                          | `setAttribute('value', canary)` on an input after `record()`                                                                                                                                                                                                                                                                                                                                                    |
| `privacy-autofill`                  | `maskAllInputs: true`                          | value set without an `input` event, then only `change` dispatched, as autofill does                                                                                                                                                                                                                                                                                                                             |
| `privacy-shadow-dom`                | `maskTextClass: 'rr-mask'`                     | an `.rr-mask` element inside an open shadow root, with text changed after `record()`                                                                                                                                                                                                                                                                                                                            |
| `privacy-adopted-stylesheet-shadow` | `maskTextClass: 'rr-mask'`                     | as above, in a shadow root that also has an adopted stylesheet replaced after `record()`                                                                                                                                                                                                                                                                                                                        |
| `privacy-input-types`               | `maskAllInputs: true`                          | every type from `input-types` that accepts free text or digits: text, email, tel, url, search and number                                                                                                                                                                                                                                                                                                        |
| `privacy-canvas-block`              | `recordCanvas: true`                           | Pixels can't be searched as text, so this check skips `assertPrivate`. It draws on a `canvas.rr-block` every frame for 500 ms. It fails with `privacy leak: blocked canvas recorded` if any CanvasMutation event targets that canvas's node id, or if its snapshot node carries `rr_dataURL`. It fails with `public control missing: canvas` unless an unblocked canvas next to it gets a CanvasMutation event. |

Commit message: `feat(prerelease): privacy checks with leak controls`.

---

### Task 8: Performance scenarios

**Files:**

- Modify: `src/page/checks/perf.ts`, `src/page/registry.ts`, `src/node/run-check.ts` (add `runScenario`), `src/node/run-targets.ts`
- Test: `test/checks.chromium.test.ts` (smoke)

**Interfaces:**

- Each scenario's `run` returns `{ ok: true, sample: PerfSample }`. Every element or rule count below is multiplied by `ctx.options.scale`, rounded, with a minimum of 1. The cycle count of `perf-record-stop-cycles` is not scaled.
- Produces `runScenario(driver, meta, src, opts: { samples: number; timeoutMs: number; scale?: number }): Promise<CheckOutcome>`. It loads a fresh page per sample.
  - It returns `status: 'pass'` with all samples. Pass or fail is decided later, in Task 13.
  - If 2 samples error, it returns `status: 'fail'` with the error message. That is a functional failure of the scenario, reported under kind `performance`.

| id                        | `compare`                  | sample                                                                                                                                            |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perf-large-stylesheet`   | durationMs                 | A `<style>` of 20,000 rules, about 2 MB. Measures the `record()` call, which takes the full snapshot.                                             |
| `perf-snapshot-5k`        | durationMs                 | 5,000 `div>span` text nodes, then measures `record()`.                                                                                            |
| `perf-snapshot-20k`       | durationMs                 | as above with 20,000                                                                                                                              |
| `perf-snapshot-50k`       | durationMs                 | as above with 50,000. Tier `full`, so it is skipped on focused targets.                                                                           |
| `perf-mutation-burst-10k` | durationMs, maxBlockMs     | While recording, measures appending 10,000 nodes in one task plus the recorder's processing.                                                      |
| `perf-sampled-canvases`   | maxBlockMs                 | 4 canvases of 300x150 drawn every frame. `record({ recordCanvas: true, sampling: { canvas: 15 } })`, measured over a 3000 ms window.              |
| `perf-record-stop-cycles` | durationMs, heapDeltaBytes | On a 2,000-node page, 20 cycles of `record()` then stop. `heapDeltaBytes` is heap after minus heap before, only when `performance.memory` exists. |

All scenarios except `perf-snapshot-50k` are tier `focused`.

- [ ] **Step 1:** Add a smoke test. Each scenario runs once on `local-chromium` with `scale: 0.02`, and the result has finite `durationMs` and `maxBlockMs` of at least 0.
- [ ] **Step 2:** Run it and expect FAIL.
- [ ] **Step 3:** Implement the scenarios and `runScenario`, and wire `runTarget` to use `t.perfSamples`.
- [ ] **Step 4:** Run the test and expect PASS. Then run `run-target --target local-chromium --check perf-snapshot-20k` and record the printed median in the commit body.
- [ ] **Step 5:** Commit with message `feat(prerelease): performance scenarios`.

---

### Task 9: Selenium driver for Firefox Nightly, Safari Technology Preview and Firefox on Android

**Files:**

- Create: `src/node/drivers/selenium.ts`, `src/node/driver-process.ts`
- Modify: `package.json` (add `selenium-webdriver@^4`, `@types/selenium-webdriver`)
- Test: `test/selenium.test.ts`

**Interfaces:**

- Produces `startDriverProcess(cmd: string, args: string[], port: number): Promise<{ url: string; stop(): Promise<void> }>`. It spawns the process and polls `http://127.0.0.1:<port>/status` until it reports ready, giving up after 30 s.
- Produces `connectSelenium(opts: { serverUrl: string; capabilities: Record<string, unknown>; canReachLocalhost: boolean; onClose?: () => Promise<void> }): Promise<PageDriver>`.
  - `loadHtml(html)` calls `get('about:blank')`, then `executeScript('document.open();document.write(arguments[0]);document.close();', html)`, then waits until `document.readyState === 'complete'`.
  - `evaluate(expr)` is `executeScript('return (' + expr + ');')`.
  - `describe()` reads `browserName`, `browserVersion` and `platformName` from the session capabilities, and `navigator.userAgent` from the page.
- The test is skipped unless `GECKODRIVER` and `FIREFOX_BINARY` are set. It runs `snapshot-basic` and `privacy-mask-all-inputs` through geckodriver and expects both to pass. This proves the `document.write` load path.
- Settings proven on 2026-11-06 that Task 10 needs:

  - **Safari Technology Preview** needs macOS 26 and installs with `brew install --cask safari-technology-preview`. Enable its driver with `sudo "/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver" --enable` and use capability `browserName: 'Safari Technology Preview'`. Stable Safari's driver is enabled with `sudo safaridriver --enable` and uses `browserName: 'safari'`.
  - **Firefox on Android:** geckodriver 0.37.1 must start with `--android-storage internal`. Without it the session fails with `fchown failed`. This is a command-line flag, not a capability. Capabilities are `{ browserName: 'firefox', 'moz:firefoxOptions': { androidPackage: 'org.mozilla.fenix', androidDeviceSerial: 'emulator-5554' } }`.

- [ ] **Step 1:** Write the test. Run it locally with `GECKODRIVER=$(which geckodriver) FIREFOX_BINARY=<firefox path>` and expect FAIL.
- [ ] **Step 2:** Implement both files.
- [ ] **Step 3:** Run the test again and expect 2 passed. If `document.write` fails to run inline scripts on any engine, fall back for that driver to the fixture server's `/check/:id` with `open()`, and record which engine needed it in the commit body.
- [ ] **Step 4:** Commit with message `feat(prerelease): Selenium driver and driver processes`.

---

### Task 10: GitHub-runner targets and browser installs

**Files:**

- Create: `src/node/install.ts`
- Modify: `src/node/targets.ts`, `package.json` (add `@puppeteer/browsers@^2`)
- Test: `test/run-target.test.ts` (definition table test)

**Interfaces:**

- Produces `githubTargets: TargetDefinition[]`, with `timeScale` 1 and `perfSamples` 5:

| id                        | engine   | channel  | pairGroup     | where          | checks             | perf         | connect                                                             |
| ------------------------- | -------- | -------- | ------------- | -------------- | ------------------ | ------------ | ------------------------------------------------------------------- |
| `chrome-canary`           | chromium | upcoming | chrome-linux  | github-linux   | all                | compare      | Playwright chromium, `executablePath` from install                  |
| `chrome-dev`              | chromium | upcoming | chrome-linux  | github-linux   | all                | compare      | same                                                                |
| `chrome-stable`           | chromium | stable   | chrome-linux  | github-linux   | all                | compare      | Playwright `channel: 'chrome'`                                      |
| `edge-dev`                | chromium | upcoming | edge-linux    | github-linux   | all                | compare      | Playwright `channel: 'msedge-dev'`                                  |
| `edge-stable`             | chromium | stable   | edge-linux    | github-linux   | all                | compare      | Playwright `channel: 'msedge'`                                      |
| `firefox-nightly`         | gecko    | upcoming | firefox-linux | github-linux   | all                | compare      | geckodriver with `moz:firefoxOptions.binary` from install, headless |
| `firefox-stable`          | gecko    | stable   | firefox-linux | github-linux   | all                | compare      | same, with `firefox@stable`                                         |
| `webkit-next`             | webkit   | upcoming | none          | github-linux   | all                | ceiling-only | Playwright webkit from `playwrightModule`                           |
| `safari-tp`               | webkit   | upcoming | safari-macos  | github-macos   | all                | compare      | safaridriver of Safari Technology Preview on port 4445              |
| `safari-stable`           | webkit   | stable   | safari-macos  | github-macos   | all                | compare      | `/usr/bin/safaridriver` on port 4446                                |
| `firefox-android-nightly` | gecko    | upcoming | none          | github-android | functional-privacy | none         | geckodriver with the Android flags from Task 9                      |

- Produces `installTarget(id: string, dir: string): Promise<Record<string, string>>`. It returns env values that `connect()` reads, through `process.env`, and the workflow appends them to `$GITHUB_ENV`. The CLI is `node src/node/install.ts <id> <dir>`, which prints `KEY=value` lines.
  - `chrome-canary` and `chrome-dev` use `@puppeteer/browsers` `install({ browser: 'chrome', buildId: <resolved 'canary' or 'dev'> })` and set `CHROME_PATH`.
  - `edge-dev` and `edge-stable` run `npx playwright install --with-deps msedge-dev` or `msedge`.
  - `firefox-nightly` and `firefox-stable` install `firefox@nightly` or `firefox@stable` with `@puppeteer/browsers` and set `FIREFOX_BINARY`. They download geckodriver 0.37.1 from its GitHub release and set `GECKODRIVER`.
  - `webkit-next` runs `npm install --prefix <dir>/pw-next playwright@next`, then that copy's `playwright install --with-deps webkit`, and sets `PLAYWRIGHT_NEXT=<dir>/pw-next/node_modules/playwright`.
  - `firefox-android-nightly` downloads the newest `*.multi.android-x86_64.apk` under `https://ftp.mozilla.org/pub/fenix/nightly/<yyyy>/<mm>/`. If the current month has no build yet, it uses the previous month. It sets `FENIX_APK` and `GECKODRIVER`.
  - The Safari targets install nothing here. The workflow does that.
- `run-target` accepts `--port-offset`, so two Selenium targets in one job don't collide.
- The test asserts that every target with a `pairGroup` and channel `upcoming` has exactly one `stable` target in the same group. It also asserts that ids are unique across `localTargets` and `githubTargets`. Targets marked "none" in the table have no `pairGroup`.

- [ ] **Step 1:** Write the table test and expect FAIL.
- [ ] **Step 2:** Implement the targets and installs.
- [ ] **Step 3:** Run the test and expect PASS. On macOS, run `node src/node/install.ts firefox-nightly /tmp/pre && run-target --target firefox-nightly --check snapshot-basic`. Expected: pass.
- [ ] **Step 4:** Commit with message `feat(prerelease): GitHub-runner targets and installs`.

---

### Task 11: BrowserStack catalogue resolution

**Files:**

- Create: `src/node/browserstack.ts` (resolution part), `test/fixtures/browserstack-browsers.json`
- Test: `test/browserstack.test.ts`

**Interfaces:**

```ts
export interface CatalogueEntry {
  os: string;
  os_version: string;
  browser: string;
  device: string | null;
  browser_version: string | null;
  real_mobile: boolean | null;
}
export interface BrowserStackSpec {
  id: string;
  engine: Engine;
  channel: 'upcoming' | 'stable';
  pairGroup?: string;
  checks: 'focused';
  perf: 'compare' | 'ceiling-only';
  route:
    | 'playwright-desktop'
    | 'playwright-ios'
    | 'playwright-android'
    | 'selenium';
  caps: Record<string, unknown>;
}
export function majorOf(osVersion: string): { major: number; beta: boolean }; // '27 Beta' gives 27, true; '14.0' gives 14, false
export function pickSameModelPair(
  entries: CatalogueEntry[],
  os: 'ios' | 'android',
  prefer: RegExp,
): { device: string; upcoming: string; stable: string } | undefined;
export function newerMacOS(
  entries: CatalogueEntry[],
  runnerMacOS: string,
): string | undefined;
export function resolveBrowserStackTargets(
  entries: CatalogueEntry[],
  runnerMacOS = 'Tahoe',
): BrowserStackSpec[];
```

- `pickSameModelPair` groups entries by device for that OS. For each device it sorts its distinct versions, with a beta above the release of the same major. It keeps devices that have at least 2 versions and whose top version equals the newest top version across all devices. Among those it prefers names matching `prefer`, then the name that sorts last.
  - `upcoming` is the device's top version and `stable` the next one down.
  - `prefer` is `/^iPhone \d+$/` for iOS and `/^Google Pixel \d+$/` for Android.
- `newerMacOS` uses a known order of `['Monterey', 'Ventura', 'Sonoma', 'Sequoia', 'Tahoe']`. It returns the newest `OS X` `os_version` in the catalogue that sorts after `runnerMacOS`. An unknown name counts as newer.
- `resolveBrowserStackTargets` returns, in this order:

  - Pair groups are `bs-chrome-win11`, `bs-edge-win11`, `bs-firefox-win11`, `bs-ios` and `bs-android`. Every other row has none.
  - `bs-chrome-beta` and `bs-chrome-stable`, playwright-desktop, caps `{ os: 'Windows', os_version: '11', browser: 'chrome', browser_version: 'latest-beta' | 'latest' }`.
  - `bs-edge-beta` and `bs-edge-stable`, the same with `browser: 'edge'`.
  - `bs-firefox-beta` and `bs-firefox-stable`, selenium, `{ browserName: 'firefox', browserVersion: 'latest-beta' | 'latest', 'bstack:options': { os: 'Windows', osVersion: '11' } }`.
  - `bs-safari-newer`, only when `newerMacOS` returns a name. It is selenium, ceiling-only, with no pair.
  - `bs-ios-upcoming` and `bs-ios-stable`, playwright-ios, `{ deviceName, osVersion, browser: 'safari', realMobile: 'true' }`.
  - `bs-android-upcoming` and `bs-android-stable`, playwright-android, `{ deviceName, osVersion, browser: 'chrome', realMobile: 'true' }`.
  - `bs-android-lowend`, ceiling-only. It takes the first of `Samsung Galaxy M32`, `Motorola Moto G71 5G` or `Samsung Galaxy A12` present, at that device's newest version.
  - `bs-samsung-internet`, selenium, ceiling-only, `browserName: 'samsung'`. It takes the first Galaxy S-series device present, at its newest version.
  - A row whose device can't be found is left out, and the CLI logs it.

- [ ] **Step 1:** Capture the live catalogue. Run `curl -su "$BROWSERSTACK_USERNAME:$BROWSERSTACK_ACCESS_KEY" https://api.browserstack.com/automate/browsers.json`. Keep only the iOS, Android and OS X entries and Windows 11 chrome, edge and firefox, and save them as the fixture. Never print or commit the credentials.
- [ ] **Step 2: Write the failing tests**

```ts
test('iOS pair uses one plain iPhone model offering both versions', () => {
  const p = pickSameModelPair(cat, 'ios', /^iPhone \d+$/)!;
  expect(p.device).toMatch(/^iPhone \d+$/);
  expect(p.upcoming).not.toBe(p.stable);
  expect(
    cat.filter((e) => e.device === p.device).map((e) => e.os_version),
  ).toEqual(expect.arrayContaining([p.upcoming, p.stable]));
});
test('a beta outranks the release of the same major', () => {
  const syn = [
    dev('iPhone 15', '26'),
    dev('iPhone 15', '27'),
    dev('iPhone 15', '27 Beta'),
  ];
  expect(pickSameModelPair(syn, 'ios', /^iPhone \d+$/)).toEqual({
    device: 'iPhone 15',
    upcoming: '27 Beta',
    stable: '27',
  });
});
test('no model has two versions: no pair', () => {
  expect(
    pickSameModelPair(
      [dev('iPhone 16', '26'), dev('iPhone 17', '27')],
      'ios',
      /./,
    ),
  ).toBeUndefined();
});
test('Safari on BrowserStack only when newer than the runner', () => {
  expect(newerMacOS([mac('Sequoia'), mac('Tahoe')], 'Tahoe')).toBeUndefined();
  expect(newerMacOS([mac('Tahoe'), mac('Zion')], 'Tahoe')).toBe('Zion');
});
test('resolved ids are unique, disjoint from GitHub ids, and every pair group has one stable', () => {
  const specs = resolveBrowserStackTargets(cat);
  const ids = [
    ...specs.map((t) => t.id),
    ...githubTargets.map((t) => t.id),
    ...localTargets.map((t) => t.id),
  ];
  expect(new Set(ids).size).toBe(ids.length);
  for (const g of new Set(
    specs.flatMap((t) => (t.pairGroup ? [t.pairGroup] : [])),
  ))
    expect(
      specs.filter((t) => t.pairGroup === g && t.channel === 'stable'),
    ).toHaveLength(1);
});
```

- [ ] **Step 3:** Run `vitest run test/browserstack.test.ts` and expect FAIL.
- [ ] **Step 4:** Implement the resolution part.
- [ ] **Step 5:** Run again and expect PASS. Commit with message `feat(prerelease): BrowserStack catalogue resolution`.

---

### Task 12: BrowserStack sessions and the pool

**Files:**

- Modify: `src/node/browserstack.ts`, `src/node/cli.ts`
- Test: `test/browserstack.test.ts`

**Interfaces:**

- `toTarget(spec: BrowserStackSpec, run: { build: string; playwrightVersion: string }): TargetDefinition`, with `where: 'browserstack'`, `timeScale` 5, `perfSamples` 3 and `canReachLocalhost: false`.
  - Common caps are `name: <id>`, `build: 'rrweb prerelease <yyyy-mm-dd> #<GITHUB_RUN_ID>'` and `project: 'rrweb prerelease browsers'`. Credentials come from `BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY`. Playwright routes pass them as `'browserstack.username'` and `'browserstack.accessKey'`, and Selenium passes them as `userName` and `accessKey` inside `'bstack:options'`, where `name`, `build` and `projectName` also go.
  - For Playwright routes, caps also carry `'client.playwrightVersion'`, and the endpoint is `wss://cdp.browserstack.com/playwright?caps=<encodeURIComponent(JSON)>`.
  - playwright-desktop: `chromium.connect`, then one `newContext()`, and a page per check.
  - playwright-ios: `webkit.connect`. BrowserStack allows one context and one tab, so the driver uses `context.pages()[0]` and resets it with `loadHtml` between checks (`singleTab: true`).
  - playwright-android: `_android.connect`, then `device.shell('am force-stop com.android.chrome')`, ignoring errors, then `device.launchBrowser()`.
  - selenium uses `https://hub-cloud.browserstack.com/wd/hub`.
  - `markSession` and `sessionUrl` go through `browserstack_executor` with actions `setSessionStatus` and `getSessionDetails`, using `public_url`.
- `isParallelLimitError(err: unknown): boolean` matches `/BROWSERSTACK_ALL_PARALLELS_IN_USE|BROWSERSTACK_QUEUE_SIZE_EXCEEDED|parallel limit/i` against the error message.
- `connectWithBackoff(connect: () => Promise<PageDriver>, deadline: Date, waitMs = 60_000, sleep = timersSleep): Promise<PageDriver>` retries only parallel-limit errors until the deadline, then throws the last error.
- `runPool<T>(jobs: Array<() => Promise<T>>, limit: number): Promise<T[]>` keeps at most `limit` jobs running and keeps results in job order.
- `cli.ts run-browserstack [--results <dir>] [--deadline <iso>] [--only <id>]...` does the following:

  - fetches the live catalogue with the credentials,
  - resolves the targets and writes their ids, one per line, to `<results>/bs-expected.txt`,
  - runs `runTarget` for each through `runPool(jobs, 5)`, with `connectWithBackoff` wrapping `connect`,
  - writes one results file per target.

- [ ] **Step 1: Write the failing tests**

```ts
test('pool never exceeds its limit and keeps order', async () => {
  let live = 0,
    peak = 0;
  const jobs = Array.from({ length: 12 }, (_, i) => async () => {
    live++;
    peak = Math.max(peak, live);
    await tick();
    live--;
    return i;
  });
  expect(await runPool(jobs, 5)).toEqual([...Array(12).keys()]);
  expect(peak).toBe(5);
});
test('backoff retries parallel-limit errors and nothing else', async () => {
  let n = 0;
  const flaky = async () => {
    if (n++ < 2) throw new Error('BROWSERSTACK_ALL_PARALLELS_IN_USE');
    return driverStub;
  };
  expect(await connectWithBackoff(flaky, future, 1, noSleep)).toBe(driverStub);
  await expect(
    connectWithBackoff(
      () => Promise.reject(new Error('bad caps')),
      future,
      1,
      noSleep,
    ),
  ).rejects.toThrow('bad caps');
});
test('backoff gives up at the deadline', async () => {
  await expect(
    connectWithBackoff(
      () => Promise.reject(new Error('parallel limit')),
      new Date(0),
      1,
      noSleep,
    ),
  ).rejects.toThrow('parallel limit');
});
```

- [ ] **Step 2:** Run the tests and expect FAIL.
- [ ] **Step 3:** Implement the session code, pool and backoff.
- [ ] **Step 4:** Run the tests and expect PASS. With credentials in the environment, run `run-browserstack --only bs-chrome-beta --only bs-ios-upcoming`. Expected: two results files with launch ok and `snapshot-basic` passing.
- [ ] **Step 5:** Commit with message `feat(prerelease): BrowserStack sessions, pool and backoff`.

---

### Task 13: Performance comparison, failure collection and parked failures

**Files:**

- Create: `src/report/compare.ts`, `src/report/failures.ts`, `test/fixtures/results/*.json`
- Test: `test/compare.test.ts`, `test/failures.test.ts`

**Interfaces:**

- `median(xs: number[]): number`
- `evaluatePerf(results: TargetResult[]): Array<{ targetId: string; checkId: string; message: string }>`. Rules:
  - **Ceiling:** on every target with `perf` other than `none`, if the median `maxBlockMs` exceeds `ceilingMs`, the message is `longest block <m> ms over <ceiling> ms ceiling`.
  - **Compare:** for each upcoming target with `perf: 'compare'`, take the stable target in its `pairGroup` and every metric in the scenario's `compare` list.
  - It fails when the upcoming median exceeds 1.5 times the stable median and the absolute difference is over 50 ms. Medians are rounded to whole numbers in messages, and the ratio uses `toFixed(2)`. For heap, the difference must be over 5 MB, and heap is skipped when either side lacks it. The message is `<metric> <u> vs stable <s> (<ratio>x)`.
  - If the stable result or its samples are missing, skip that comparison and mention it in `notes`.
- Constants: `RATIO_LIMIT = 1.5`, `MIN_DIFF_MS = 50`, `MIN_HEAP_DIFF = 5 * 1024 * 1024`.
- `parseKnownFailures(json: unknown, now: Date): { active: KnownFailure[]; expired: KnownFailure[] }`, where `KnownFailure = { key: string; engines?: Engine[]; upstream: string; expires: string; note?: string }`. It throws on a key not matching `/^[a-z0-9-]+:(functional|privacy|performance)$/`, a non-`https:` upstream, or an invalid date.
- `collectFailures(results: TargetResult[], expectedTargets: string[], known: KnownFailure[]): RunSummary`

```ts
export interface FailureTarget {
  targetId: string;
  engine: Engine;
  channel: 'upcoming' | 'stable';
  browser?: BrowserInfo;
  message: string;
  eventsFile?: string;
  sessionUrl?: string;
  reproduce: string;
}
export interface Failure {
  key: string; // `${checkId}:${kind}`
  checkId: string;
  kind: CheckKind;
  targets: FailureTarget[];
  engines: Engine[]; // sorted, unique
  alsoFailsOnStable: boolean;
}
export interface RunSummary {
  failures: Failure[];
  parked: Array<{ failure: Failure; entry: KnownFailure }>;
  flaky: Array<{ key: string; targetId: string }>;
  launchFailures: Array<{ targetId: string; error: string }>;
  missingTargets: string[]; // expected, but no results file
  incompleteTargets: string[];
  passedOn: Record<string, string[]>; // key -> targetIds where it ran and passed
  totalKeys: number; // distinct keys that ran (pass, fail or flaky) on any target
  notes: string[];
}
```

- `reproduce` is `yarn workspace @rrweb/prerelease-browsers run-target --target <id> --check <checkId>`.
- A performance check with `status: 'pass'` that `evaluatePerf` flags becomes a failure of kind `performance`. A performance check with `status: 'fail'` is also a `performance` failure, carrying its error message.
- `parked` takes the targets whose engine is covered by an active entry with the same key. A failure with no targets left moves entirely to `parked`. An expired entry parks nothing.

- [ ] **Step 1: Write the failing tests**

```ts
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
test('ceiling applies to stable targets and unpaired ones too', () => {
  expect(
    evaluatePerf([
      perfBlock('bs-samsung-internet', 'ceiling-only', [1200, 1300, 900]),
    ]).map((f) => f.message),
  ).toEqual(['longest block 1200 ms over 1000 ms ceiling']);
});
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
    engines: ['chromium'],
    alsoFailsOnStable: true,
  });
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
  expect(parseKnownFailures([entry], new Date('2026-12-02')).active).toEqual(
    [],
  );
});
test('known-failures with an http link is rejected', () => {
  expect(() =>
    parseKnownFailures(
      [{ key: 'a:functional', upstream: 'http://x', expires: '2027-01-01' }],
      new Date(),
    ),
  ).toThrow();
});
```

- [ ] **Step 2:** Run `vitest run test/compare.test.ts test/failures.test.ts` and expect FAIL.
- [ ] **Step 3:** Implement both modules and the fixtures.
- [ ] **Step 4:** Run again and expect PASS. Commit with message `feat(prerelease): performance comparison and failure collection`.

---

### Task 14: Planning issue actions

**Files:**

- Create: `src/report/issues-plan.ts`
- Test: `test/issues-plan.test.ts`

**Interfaces:**

- Consumes: `RunSummary`, `Failure` from Task 13.

```ts
export interface ExistingIssue {
  number: number;
  state: 'open' | 'closed';
  labels: string[];
  body: string;
  key: string; // parsed from the body marker
  engines: Engine[]; // parsed from the body marker
  failingTargets: string[]; // parsed from the body marker
}
export type IssueAction =
  | { type: 'create'; failure: Failure }
  | { type: 'update'; issue: number; failure: Failure }
  | {
      type: 'reopen';
      issue: number;
      failure: Failure;
      reason: 'regressed' | 'spread';
    }
  | { type: 'close'; issue: number; key: string }
  | { type: 'run-broken'; issue?: number; failures: Failure[] };
export interface IssuePlan {
  actions: IssueAction[];
  closedButFailing: Array<{ issue: number; key: string }>;
}
export const MASS_FAILURE_SHARE = 0.3;
export const MASS_FAILURE_MIN = 5;
export function planIssueActions(
  summary: RunSummary,
  existing: ExistingIssue[],
  runBrokenIssue?: ExistingIssue,
): IssuePlan;
```

Rules, in order:

1. **Mass failure.** When `failures.length >= MASS_FAILURE_MIN` and `failures.length / totalKeys >= MASS_FAILURE_SHARE`, the plan is a single `run-broken` action, with `issue` set if `runBrokenIssue` is open, and no per-check actions.
2. **Per failure,** matched to an existing issue by `key`, open or closed:
   - No match gives `create`.
   - An open match gives `update`.
   - A closed match labelled `prerelease:recovered` gives `reopen`, reason `regressed`.
   - A closed match without that label was closed by hand. It gives `reopen`, reason `spread`, only if the failure has an engine missing from `issue.engines`. Otherwise it gives no action and an entry in `closedButFailing`.
3. **Per open issue with no failure this run:** `close`, but only if every target in `failingTargets` appears in `summary.passedOn[key]`. A failing target that is missing, incomplete, failed to launch, was flaky, or didn't run the check keeps the issue open.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2:** Run `vitest run test/issues-plan.test.ts` and expect FAIL.
- [ ] **Step 3:** Implement `planIssueActions`.
- [ ] **Step 4:** Run again and expect PASS. Commit with message `feat(prerelease): plan issue actions from a run`.

---

### Task 15: Rendering, the GitHub client and the report step

**Files:**

- Create: `src/report/render.ts`, `src/report/github.ts`, `src/report/reconcile.ts`
- Test: `test/render.test.ts`, `test/reconcile.test.ts`

**Interfaces:**

- `render.ts`
  - Markers are HTML comments: `<!-- prerelease:key=<key> -->`, `<!-- prerelease:engines=<a,b> -->`, `<!-- prerelease:targets=<a,b> -->`, and the history block between `<!-- prerelease:history -->` and `<!-- /prerelease:history -->`. The status issue carries `<!-- prerelease:status -->`, and the run-broken issue `<!-- prerelease:run-broken -->`.
  - `parseMarkers(body: string): { key?: string; engines: Engine[]; targets: string[]; history: string[] }`
  - `issueTitle(f: Failure): string` gives `[pre-release] <kind>: <checkId> fails on <engines joined by ", ">`.
  - `issueBody(f: Failure, run: RunMeta, previousBody?: string): string`. The body holds a one-line summary and a table of failing targets with target, browser and version, platform or device, message and session link. Then come the reproduce commands in a `bash` block, a link to the run's artifacts for the events, and a history table of the last 10 runs, newest first, carried over from `previousBody`. If the body would exceed 60,000 characters, it truncates messages to 500 characters, then drops the oldest history rows.
  - The summary line names the rrweb commit from `RunMeta`.
  - Bodies never contain `@` followed by a letter, so editing a body notifies nobody. Escape any such `@` as `@<!-- -->`.
  - `labelsFor(f: Failure): string[]` gives `prerelease`, `prerelease:<kind>` and `engine:<engine>` per engine, plus `privacy` and `severity:critical` for privacy, plus `prerelease:also-fails-on-stable` when that applies.
  - `statusBody(s: RunSummary, plan: IssuePlan, run: RunMeta, results: TargetResult[], issueLinks: Record<string, number>): string`. It shows the date, a run link and `complete` or `incomplete`. The targets table has id, version, launch, and pass, fail, flaky and skipped counts. Sections follow for open failures, closed but still failing, parked with expiry dates, flaky, launch failures and missing targets.
  - `RunMeta = { runUrl: string; date: string; rrwebCommit: string }`
- `github.ts`, a `GitHub` class over `fetch` using `GITHUB_TOKEN`, `GITHUB_REPOSITORY` and `GITHUB_API_URL`:
  - `listIssues(label: string): Promise<Array<{ number; state; labels: string[]; body: string; node_id: string }>>` covers all states and paginates at 100 per page.
  - Also `createIssue`, `updateIssue(number, { title?, body?, state?, state_reason?, labels? })`, `comment`, `ensureLabels(names: string[])`, which creates missing labels with fixed colours, and `pinIssue(nodeId)` through the GraphQL mutation `pinIssue`.
- `reconcile.ts`, run as `node src/report/reconcile.ts --results <dir> --expected <ids,comma> [--apply]`:

  - Reads the results, `known-failures.json`, and the issues labelled `prerelease`, then parses their markers.
  - Plans, then applies when `--apply` is given, or prints the plan as JSON otherwise.
  - Applying works like this:
    - `create` opens the issue with `labelsFor`.
    - `update` rewrites title, body and labels, with no comment.
    - `reopen` sets state open, removes `prerelease:recovered` and adds one comment: `Failing again in <run link>.`
    - `close` adds the comment `Passed on every target that failed before, in <run link>.`, then closes with `state_reason: completed` and adds `prerelease:recovered`.
    - `run-broken` creates or updates the single issue labelled `prerelease:run-broken`.
  - Finally it updates the status issue labelled `prerelease:status`, creating and pinning it when missing.
  - It exits non-zero only on API errors.

- [ ] **Step 1: Write the failing tests**

```ts
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
// test/reconcile.test.ts uses a fake GitHub with the same method names, in memory
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
```

`test/fixtures/results` holds exactly one failing functional check, on `chrome-canary`, and nothing else failing. `GitHubLike` is `Pick<GitHub, 'listIssues' | 'createIssue' | 'updateIssue' | 'comment' | 'ensureLabels' | 'pinIssue'>`.
Export `reconcile(opts: { gh: GitHubLike; results: TargetResult[]; expected: string[]; apply: boolean; known?: KnownFailure[]; run?: RunMeta }): Promise<IssuePlan>` from `reconcile.ts`, so the CLI and the test share it.

- [ ] **Step 2:** Run `vitest run test/render.test.ts test/reconcile.test.ts` and expect FAIL.
- [ ] **Step 3:** Implement the three modules.
- [ ] **Step 4:** Run again and expect PASS. Then run `node src/report/reconcile.ts --results test/fixtures/results --expected chrome-canary,chrome-stable`, without `--apply` and with `GITHUB_REPOSITORY` set to your fork. Expected: a JSON plan and no writes.
- [ ] **Step 5:** Commit with message `feat(prerelease): render issues and reconcile a run`.

---

### Task 16: The workflow

**Files:**

- Create: `.github/workflows/prerelease-browsers.yml`, `packages/prerelease-browsers/README.md`

**Interfaces:**

- Consumes: `install.ts`, `cli.ts run-target`, `cli.ts run-browserstack` and `reconcile.ts`.

Workflow shape:

- `on.schedule`: `cron: '17 5 * * 1'`. `on.workflow_dispatch.inputs`: `browserstack` (boolean, default false) and `targets` (string, default empty, a comma list to limit GitHub targets).
- `concurrency: { group: prerelease-browsers, cancel-in-progress: false }`. Top-level `permissions: { contents: read }`.
- Job `gate` on `ubuntu-latest`, with outputs `run`, `browserstack`, `deadline`, `linux_targets`, `run_macos`, `run_android` and `expected`:
  - On schedule, `run` is true only when `github.repository == 'rrweb-io/rrweb'` and `$(( $(date -u +%V) % 2 )) == 0`.
  - On dispatch, `run` is always true.
  - `browserstack` is true on schedule, otherwise the input.
  - `deadline` is `date -u -d '+105 minutes' +%FT%TZ`.
  - `linux_targets` is a JSON array of the 8 Linux ids, filtered by the `targets` input when it is set. `run_macos` and `run_android` are true unless the input is set without their ids.
  - `expected` is the comma list of every GitHub target id that will run.
- Job `build`: checkout, `actions/setup-node` with `node-version: lts/*` and `cache: yarn`, then `yarn install --frozen-lockfile` with `PUPPETEER_SKIP_DOWNLOAD: true`. Then `yarn turbo run prepublish --filter=rrweb`, and upload `packages/rrweb/dist` as artifact `rrweb-dist`.
- Every runner job does checkout, setup-node, yarn install, then downloads `rrweb-dist` into `packages/rrweb/dist`. It sets `PRERELEASE_DEADLINE=${{ needs.gate.outputs.deadline }}`, uses `timeout-minutes: 100`, and uploads `packages/prerelease-browsers/results` as `results-<job or target>` with `if: always()`.
- Job `linux`: `strategy.fail-fast: false`, with `matrix.target: ${{ fromJSON(needs.gate.outputs.linux_targets) }}`. The 8 ids are chrome-canary, chrome-dev, chrome-stable, edge-dev, edge-stable, firefox-nightly, firefox-stable and webkit-next. The `macos` and `android` jobs run only when `run_macos` or `run_android` is true. Steps: `node src/node/install.ts $T $RUNNER_TEMP/browsers >> $GITHUB_ENV`, then `xvfb-run yarn workspace @rrweb/prerelease-browsers run-target --target $T --deadline $PRERELEASE_DEADLINE`.
- Job `macos` on `macos-26`: `brew install --cask safari-technology-preview`, then enable both safaridrivers as in Task 9. Run `safari-stable`, then `safari-tp` with `--port-offset 1`.
- Job `android` on `ubuntu-latest`:
  - Enable KVM with `echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules`, then `sudo udevadm control --reload-rules && sudo udevadm trigger --name-match=kvm`.
  - Run install for `firefox-android-nightly`.
  - Use `reactivecircus/android-emulator-runner@v2` with `api-level: 34`, `target: google_apis`, `arch: x86_64`. Its script runs `adb install -r $FENIX_APK && adb reverse tcp:8123 tcp:8123 && adb reverse tcp:8124 tcp:8124 && yarn workspace @rrweb/prerelease-browsers run-target --target firefox-android-nightly`.
  - Upload `adb logcat -d` output as an artifact on failure.
- Job `browserstack`: runs `if: needs.gate.outputs.browserstack == 'true'` with env `BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY` from secrets, then `run-browserstack --deadline ...`.
- Job `report`:
  - `needs: [gate, linux, macos, android, browserstack]`, `if: always() && needs.gate.outputs.run == 'true'`, `permissions: { contents: read, issues: write }`.
  - Download all `results-*` artifacts merged into one dir, then run `node src/report/reconcile.ts --results <dir> --expected <ids> --apply` with `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
  - `--expected` is the gate's `expected` output, plus the ids in `bs-expected.txt` when BrowserStack ran. If BrowserStack was due but `bs-expected.txt` is missing, the status issue reports BrowserStack as missing.

README sections:

- **Run one target locally,** with `install.ts` and `run-target` and the build prerequisite.
- **Reproduce an issue,** using the command copied from the issue.
- **Park a known failure,** covering the `known-failures.json` format, the https link and the expiry date.
- **Change the limits,** naming the constants in `compare.ts` and `issues-plan.ts`.
- **Test on a fork.** Enable workflows on the fork's Actions tab first, and add the two BrowserStack secrets.

- [ ] **Step 1:** Validate the YAML with `npx -y js-yaml .github/workflows/prerelease-browsers.yml > /dev/null`. Expected: no error.
- [ ] **Step 2:** Run `yarn lint` and `yarn workspace @rrweb/prerelease-browsers check-types`. Expected: clean.
- [ ] **Step 3:** Commit with message `ci(prerelease): biweekly pre-release browser workflow`.

---

### Task 17: Per-PR runs

**Files:**

- Create: `src/report/pr-summary.ts`, `test/pr-summary.test.ts`, `.github/workflows/prerelease-browsers-pr.yml`
- Modify: `src/node/targets.ts` (add `asPrRole`), `src/node/run-targets.ts` (add `rrwebDist`), `src/node/cli.ts` (add flags), `test/run-target.test.ts`, `README.md`

**Interfaces:**

- Consumes: `TargetDefinition`, `findTarget`, `runTarget` (Task 3), `githubTargets` (Task 10), `collectFailures`, `evaluatePerf` and `parseKnownFailures` (Task 13), `readResults` (Task 3).
- Produces `asPrRole(t: TargetDefinition, role: 'pr' | 'base'): TargetDefinition` in `targets.ts`. It returns a copy with:
  - `id` set to `` `${t.id}@${role}` ``
  - `channel` set to `'upcoming'` for `pr` and `'stable'` for `base`, so that `evaluatePerf` compares the pull request's rrweb against the base branch's with the existing rules
  - `pairGroup` set to `` `pr-${t.id}` ``
  - `checks` set to `'focused'` and `perf` to `'compare'`
- `runTarget` options gain `rrwebDist?: string`, which is passed to `readRrwebUmd`. The fixture server uses the same rrweb source.
- `cli.ts run-target` gains `--pr-role pr|base`, which wraps the target with `asPrRole`, plus `--rrweb-dist <dir>` and `--rrweb-commit <sha>`. Without `--rrweb-commit`, the commit stays `git rev-parse HEAD`.
- Produces in `pr-summary.ts`:

```ts
export interface PrFinding {
  targetId: string;
  key: string;
  message: string;
  reproduce: string;
} // targetId without the @role suffix
export interface PrVerdict {
  failures: PrFinding[];
  warnings: PrFinding[];
  incomplete: string[];
  markdown: string;
}
export function summarizePr(
  results: TargetResult[],
  expectedTargets: string[],
  known: KnownFailure[],
): PrVerdict;
```

Rules, applied to `collectFailures(results, expectedTargets, known)`:

- For each failure, each `@pr` target whose `@base` counterpart is also among that failure's targets becomes a warning with the message prefix `also fails on base: `. A `@pr` target without one becomes a failure.
- Targets that fail only as `@base` become warnings.
- Launch failures become warnings with the message prefix `browser failed to launch: `.
- Missing and incomplete targets go in `incomplete`.
- `reproduce` is `yarn workspace @rrweb/prerelease-browsers run-target --target <id> --pr-role pr --check <checkId>`.
- `markdown` is the job summary. It has a one-line verdict: `Pass`, `Fail: <n> failing` or `Incomplete`. Then come a failures table and a warnings table, each with target, check, message and reproduce command, and a list of incomplete targets. It never contains `@` followed by a letter, using the same escaping as `render.ts`.
- CLI: `node src/report/pr-summary.ts --results <dir> --expected <ids,comma>`. It appends `markdown` to the file named by `GITHUB_STEP_SUMMARY` when that is set, and prints it otherwise. It exits 1 when there are failures or incomplete targets, and 0 otherwise.

Workflow `.github/workflows/prerelease-browsers-pr.yml`:

- `on.pull_request.paths`: `packages/rrweb/**`, `packages/rrweb-snapshot/**`, `packages/rrdom/**`, `packages/types/**`, `packages/utils/**`, `packages/prerelease-browsers/**`, `.github/workflows/prerelease-browsers-pr.yml`. It also triggers on `types: [opened, synchronize, reopened, labeled]`, so adding the `safari` label starts a run.
- `permissions: { contents: read }`. `concurrency: { group: prerelease-pr-${{ github.event.pull_request.number }}, cancel-in-progress: true }`. The workflow references no secrets.
- Job `build`: build rrweb from the pull request and upload it as `rrweb-dist-pr`. Use the same install and build steps as Task 16's `build` job.
- Job `build-base`: the same, but check out `${{ github.event.pull_request.base.sha }}`, and upload as `rrweb-dist-base`.
- Job `linux`, with `needs: [build, build-base]`, `fail-fast: false`, `timeout-minutes: 30`, and matrix target `[chrome-stable, edge-stable, firefox-stable, local-webkit]`:
  1. Download `rrweb-dist-pr` into `packages/rrweb/dist` and `rrweb-dist-base` into `$RUNNER_TEMP/base-dist`.
  2. Install the browser. `local-webkit` uses `npx playwright install --with-deps webkit`, and the others use `install.ts`.
  3. Run `xvfb-run yarn workspace @rrweb/prerelease-browsers run-target --target $T --pr-role pr --deadline <now + 25 min>`.
  4. Run the same command with `--pr-role base --rrweb-dist $RUNNER_TEMP/base-dist --rrweb-commit ${{ github.event.pull_request.base.sha }}`.
  5. Upload `results` as `pr-results-$T` with `if: always()`.
- Job `safari`: runs `if: contains(github.event.pull_request.labels.*.name, 'safari')` on `macos-26`. It enables the stable safaridriver as in Task 16 and runs both roles for `safari-stable`.
- Job `summary`: `needs: [linux, safari]` and `if: always()`. It downloads every `pr-results-*` artifact into one directory. It runs `pr-summary.ts` with `--expected` listing each matrix target as `@pr` and `@base`, plus `safari-stable@pr` and `safari-stable@base` when the label is set. This is the job a branch rule can require.

- [ ] **Step 1: Write the failing tests**

```ts
// test/pr-summary.test.ts, with fixtures built by the helpers from Task 13's tests
const expected = ['chrome-stable@pr', 'chrome-stable@base'];
test('a check failing only with the PR rrweb fails the run', () => {
  const v = summarizePr(
    [
      failing(
        'chrome-stable@pr',
        'css-nested-rules',
        'upcoming',
        'pr-chrome-stable',
      ),
      passing('chrome-stable@base', 'stable', 'pr-chrome-stable'),
    ],
    expected,
    [],
  );
  expect(v.failures).toEqual([
    expect.objectContaining({
      targetId: 'chrome-stable',
      key: 'css-nested-rules:functional',
    }),
  ]);
  expect(v.warnings).toEqual([]);
  expect(v.markdown).toMatch(/^Fail: 1 failing/m);
});
test('a check failing with both builds is only a warning', () => {
  const v = summarizePr(
    [
      failing(
        'chrome-stable@pr',
        'css-nested-rules',
        'upcoming',
        'pr-chrome-stable',
      ),
      failing(
        'chrome-stable@base',
        'css-nested-rules',
        'stable',
        'pr-chrome-stable',
      ),
    ],
    expected,
    [],
  );
  expect(v.failures).toEqual([]);
  expect(v.warnings[0].message).toMatch(/^also fails on base: /);
});
test('PR rrweb 1.6x slower than base fails', () => {
  const v = summarizePr(
    [
      perf('chrome-stable@pr', 'upcoming', [160, 170, 165], 'pr-chrome-stable'),
      perf('chrome-stable@base', 'stable', [100, 105, 102], 'pr-chrome-stable'),
    ],
    expected,
    [],
  );
  expect(v.failures[0].message).toMatch(/^durationMs 165 vs stable 102/);
});
test('a missing base result makes the run incomplete', () => {
  const v = summarizePr(
    [passing('chrome-stable@pr', 'upcoming', 'pr-chrome-stable')],
    expected,
    [],
  );
  expect(v.incomplete).toEqual(['chrome-stable@base']);
  expect(v.markdown).toMatch(/^Incomplete/m);
});
// test/run-target.test.ts
test('asPrRole pairs the two builds for comparison', () => {
  const pr = asPrRole(findTarget('chrome-stable'), 'pr'),
    base = asPrRole(findTarget('chrome-stable'), 'base');
  expect([pr.id, pr.channel, base.id, base.channel]).toEqual([
    'chrome-stable@pr',
    'upcoming',
    'chrome-stable@base',
    'stable',
  ]);
  expect(pr.pairGroup).toBe(base.pairGroup);
  expect([pr.checks, pr.perf]).toEqual(['focused', 'compare']);
});
```

If the Task 13 helpers don't accept a target id with `@` and an explicit pairGroup, extend them in that test file.

- [ ] **Step 2:** Run `vitest run test/pr-summary.test.ts test/run-target.test.ts` and expect FAIL.
- [ ] **Step 3:** Implement `asPrRole`, the `rrwebDist` option, the CLI flags and `pr-summary.ts`.
- [ ] **Step 4:** Run the tests again and expect PASS. Then run both roles locally against `local-chromium`, using a second rrweb build as the base. Copy `packages/rrweb/dist` to a temporary directory and pass it with `--rrweb-dist`. Run `pr-summary.ts` on the results. Expected: `Pass` and exit 0.
- [ ] **Step 5:** Validate the YAML with `npx -y js-yaml .github/workflows/prerelease-browsers-pr.yml > /dev/null`. Add a README section, "Per-PR runs", covering what fails a pull request, the `safari` label, and how to reproduce locally. Run `yarn lint` and check-types.
- [ ] **Step 6:** Commit with message `ci(prerelease): run the focused checks on every pull request`.

---

### Task 18: First real run and tuning

**Files:**

- Modify: as the run requires, usually `src/node/targets.ts` (`ceilingMs`), `known-failures.json` or a check

This task is verification. It ends with evidence, not new features.

- [ ] **Step 1:** Ask the maintainer before pushing the branch to their fork and dispatching. Pushing publishes the branch. Then dispatch with `browserstack: false` and wait for the run.
- [ ] **Step 2:** Confirm the result.
  - Every GitHub target has a results file.
  - The status issue exists on the fork and is pinned.
  - Its wall-clock time and per-job times are recorded in the commit body.
- [ ] **Step 3:** For each failure, decide which kind it is.
  - **A real upcoming-browser break:** keep it, and report it upstream.
  - **A current rrweb gap on stable too:** remove the check and list it in the pull request.
  - **An unrealistic ceiling on a slow target:** raise that target's `ceilingMs` and note the measured median.
- [ ] **Step 4:** With the maintainer's go-ahead and the fork's secrets set, dispatch again with `browserstack: true`. Confirm the BrowserStack job finishes before the deadline with at most 5 concurrent sessions, which the BrowserStack dashboard shows. Confirm the whole run is under 2 hours.
- [ ] **Step 5:** Run dispatch a second time on the same commit. Confirm no new issues and no new comments appear.
- [ ] **Step 5a:** With the maintainer's go-ahead, open a throwaway pull request on the fork that changes one comment in `packages/rrweb/src`. Confirm the per-PR workflow runs all four Linux targets in both roles, the summary job passes, and its run time is under 30 minutes. Add the `safari` label and confirm the Safari job runs. Then close the pull request.
- [ ] **Step 6:** Commit the tuning with message `chore(prerelease): tune limits from first full run`. Then open the pull request to rrweb-io/rrweb only once the maintainer asks.
