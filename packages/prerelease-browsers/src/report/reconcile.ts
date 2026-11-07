/* eslint-disable camelcase -- GitHub's REST API names its fields in snake_case */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readResults, type TargetResult } from '../node/results.ts';
import type { Engine } from '../types.ts';
import {
  collectFailures,
  parseKnownFailures,
  type Failure,
  type KnownFailure,
} from './failures.ts';
import { GitHub, type IssueData } from './github.ts';
import {
  planIssueActions,
  RECOVERED_LABEL,
  type ExistingIssue,
  type IssuePlan,
} from './issues-plan.ts';
import {
  issueBody,
  issueTitle,
  labelsFor,
  parseMarkers,
  RUN_BROKEN_MARKER,
  runBrokenBody,
  runBrokenTitle,
  runLink,
  STATUS_MARKER,
  statusBody,
  statusTitle,
  type RunCount,
  type RunMeta,
} from './render.ts';

export type GitHubLike = Pick<
  GitHub,
  | 'listIssues'
  | 'createIssue'
  | 'updateIssue'
  | 'comment'
  | 'ensureLabels'
  | 'pinIssue'
>;

export interface ReconcileOptions {
  gh: GitHubLike;
  results: TargetResult[];
  expected: string[];
  apply: boolean;
  known?: KnownFailure[];
  run?: RunMeta;
  /** BrowserStack was due, but its job wrote no list of expected targets. */
  browserstackMissing?: boolean;
  /** Targets a hand-started run left out; the status then reads as a partial run. */
  leftOut?: string[];
  /** At most this many issues open or reopen in one run; absent, no cap. */
  issueCap?: number;
  log?: (line: string) => void;
}

const RUN_BROKEN_LABEL = 'prerelease:run-broken';
const STATUS_LABEL = 'prerelease:status';
const BASE_LABELS = [
  'prerelease',
  RECOVERED_LABEL,
  RUN_BROKEN_LABEL,
  STATUS_LABEL,
];

/**
 * Labels only this suite used and no longer adds. They are treated as derived
 * so an update takes them off. `severity:critical` is not among them: the
 * name is generic, and a maintainer may have put it on an issue themselves.
 */
const RETIRED_LABELS = ['prerelease:also-fails-on-stable', 'prerelease:privacy'];

/** Labels the reporter derives from a failure, so it may take them away. */
const derived = (label: string) =>
  label.startsWith('engine:') ||
  RETIRED_LABELS.includes(label) ||
  label === RECOVERED_LABEL;

/** The issue's labels with the derived ones replaced by `wanted`. */
function mergeLabels(current: string[], wanted: string[]): string[] {
  const kept = current.filter((l) => !derived(l));
  return [...kept, ...wanted.filter((w) => !kept.includes(w))];
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length &&
  [...a].sort().join('\n') === [...b].sort().join('\n');

const withLabel = (labels: string[], label: string) =>
  labels.includes(label) ? labels : [...labels, label];

/** Open before closed, then the newest. */
const preferred = (issues: IssueData[]): IssueData | undefined =>
  [...issues].sort((a, b) =>
    a.state !== b.state ? (a.state === 'open' ? -1 : 1) : b.number - a.number,
  )[0];

/**
 * Sorts the `prerelease` issues by their markers: per-check issues carry a
 * key; the status and run-broken issues carry their own marker. Anything else
 * is left alone. A per-check issue whose notified marker names `run` was
 * opened or reopened by an earlier attempt of this run; a run without an id
 * matches none.
 */
function classify(listed: IssueData[], run: RunMeta) {
  const existing: ExistingIssue[] = [];
  const status: IssueData[] = [];
  const broken: IssueData[] = [];
  for (const i of listed) {
    const m = parseMarkers(i.body);
    if (m.key) {
      existing.push({
        number: i.number,
        state: i.state,
        labels: i.labels,
        body: i.body,
        key: m.key,
        engines: m.engines,
        failingTargets: m.targets,
        notifiedThisRun: run.runId !== undefined && m.notified === run.runUrl,
      });
    } else if (i.body.includes(STATUS_MARKER)) {
      status.push(i);
    } else if (i.body.includes(RUN_BROKEN_MARKER)) {
      broken.push(i);
    }
  }
  const b = preferred(broken);
  const runBroken: ExistingIssue | undefined = b && {
    number: b.number,
    state: b.state,
    labels: b.labels,
    body: b.body,
    key: 'run-broken',
    engines: [],
    failingTargets: [],
  };
  return { existing, status: preferred(status), runBroken };
}

/** Run details from the Actions environment, falling back to the results. */
export function runMetaFromEnv(
  results: TargetResult[],
  env: NodeJS.ProcessEnv = process.env,
): RunMeta {
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
  const repo = env.GITHUB_REPOSITORY ?? 'rrweb-io/rrweb';
  const started = results.map((r) => r.startedAt).sort()[0];
  const commits = [...new Set(results.map((r) => r.rrwebCommit))].sort();
  const runId = env.GITHUB_RUN_ID || undefined;
  return {
    runUrl: runId
      ? `${server}/${repo}/actions/runs/${runId}`
      : `${server}/${repo}/actions`,
    ...(runId ? { runId } : {}),
    date: (started ?? new Date().toISOString()).slice(0, 10),
    rrwebCommit:
      commits.length > 0 ? commits.join(', ') : env.GITHUB_SHA ?? 'unknown',
  };
}

const withEngines = (f: Failure, engines: Engine[]): Failure => ({
  ...f,
  engines,
});

/**
 * Reads the issue tracker, plans what this run changes, and applies the plan
 * when `apply` is set. Only creates, reopens and comments notify anyone; an
 * update that would change nothing is skipped.
 */
export async function reconcile(opts: ReconcileOptions): Promise<IssuePlan> {
  const { gh, results, expected, apply } = opts;
  const log = opts.log ?? (() => undefined);
  const run = opts.run ?? runMetaFromEnv(results);
  const summary = collectFailures(results, expected, opts.known ?? []);
  const listed = await gh.listIssues('prerelease');
  const { existing, status, runBroken } = classify(listed, run);

  // A run that is missing BrowserStack's results, or that a maintainer
  // limited by hand, is not complete. Counting the gaps as missing for
  // planning keeps an open run-broken issue open; passedOn is untouched, so
  // per-check planning is the same. The status body names both itself.
  const gaps = [
    ...(opts.browserstackMissing ? ['browserstack'] : []),
    ...(opts.leftOut ?? []),
  ];
  const planned =
    gaps.length > 0
      ? { ...summary, missingTargets: [...summary.missingTargets, ...gaps] }
      : summary;
  const plan = planIssueActions(planned, existing, runBroken, opts.issueCap);
  if (!apply) return plan;

  const count: RunCount = {
    failing: summary.failures.length,
    heldBack: plan.heldBack.length,
    ...(opts.issueCap === undefined ? {} : { cap: opts.issueCap }),
  };

  const byNumber = new Map(listed.map((i) => [i.number, i]));
  const current = (n: number) => {
    const i = byNumber.get(n);
    if (!i) throw new Error(`issue #${n} is not among the listed issues`);
    return i;
  };
  const links: Record<string, number> = {};

  await gh.ensureLabels([
    ...BASE_LABELS,
    ...plan.actions.flatMap((a) =>
      a.type === 'create'
        ? labelsFor(a.failure)
        : a.type === 'update' || a.type === 'reopen'
        ? labelsFor(withEngines(a.failure, a.recordEngines))
        : [],
    ),
  ]);

  for (const a of plan.actions) {
    switch (a.type) {
      case 'create': {
        const created = await gh.createIssue({
          title: issueTitle(a.failure),
          body: issueBody(a.failure, run, count),
          labels: labelsFor(a.failure),
        });
        links[a.failure.key] = created.number;
        log(`opened #${created.number} for ${a.failure.key}`);
        break;
      }
      case 'update':
      case 'reopen': {
        const prev = current(a.issue);
        const f = withEngines(a.failure, a.recordEngines);
        const title = issueTitle(f, a.recordTargets);
        const body = issueBody(a.failure, run, count, {
          body: prev.body,
          record: a,
          reopened: a.type === 'reopen',
        });
        const labels = mergeLabels(prev.labels, labelsFor(f));
        links[a.failure.key] = a.issue;
        if (a.type === 'reopen') {
          await gh.updateIssue(a.issue, { state: 'open', title, body, labels });
          await gh.comment(a.issue, `Failing again in ${runLink(run)}.`);
          log(`reopened #${a.issue} for ${a.failure.key} (${a.reason})`);
        } else if (
          title !== prev.title ||
          body !== prev.body ||
          !sameSet(labels, prev.labels)
        ) {
          await gh.updateIssue(a.issue, { title, body, labels });
          log(`updated #${a.issue} for ${a.failure.key}`);
        }
        break;
      }
      case 'close': {
        const prev = current(a.issue);
        await gh.comment(
          a.issue,
          `Passed on every target that failed before, in ${runLink(run)}.`,
        );
        await gh.updateIssue(a.issue, {
          state: 'closed',
          state_reason: 'completed',
          labels: withLabel(prev.labels, RECOVERED_LABEL),
        });
        log(`closed #${a.issue} for ${a.key}`);
        break;
      }
      case 'mark-recovered': {
        const prev = current(a.issue);
        await gh.updateIssue(a.issue, {
          labels: withLabel(prev.labels, RECOVERED_LABEL),
        });
        log(`marked #${a.issue} recovered for ${a.key}`);
        break;
      }
      case 'run-broken': {
        const title = runBrokenTitle(a.failures);
        const body = runBrokenBody(a.failures, summary, run);
        if (a.issue === undefined) {
          const created = await gh.createIssue({
            title,
            body,
            labels: ['prerelease', RUN_BROKEN_LABEL],
          });
          links['run-broken'] = created.number;
          log(`opened run-broken #${created.number}`);
          break;
        }
        const prev = current(a.issue);
        const labels = withLabel(
          withLabel(prev.labels, 'prerelease'),
          RUN_BROKEN_LABEL,
        );
        links['run-broken'] = a.issue;
        if (prev.state === 'closed') {
          await gh.updateIssue(a.issue, { state: 'open', title, body, labels });
          await gh.comment(a.issue, `Broken again in ${runLink(run)}.`);
          log(`reopened run-broken #${a.issue}`);
        } else if (
          title !== prev.title ||
          body !== prev.body ||
          !sameSet(labels, prev.labels)
        ) {
          await gh.updateIssue(a.issue, { title, body, labels });
          log(`updated run-broken #${a.issue}`);
        }
        break;
      }
      case 'close-run-broken': {
        await gh.comment(a.issue, `Run healthy again in ${runLink(run)}.`);
        await gh.updateIssue(a.issue, {
          state: 'closed',
          state_reason: 'completed',
        });
        log(`closed run-broken #${a.issue}`);
        break;
      }
    }
  }

  for (const h of plan.heldBack) {
    log(`held back ${h.key} by the per-run issue cap`);
  }

  const body = statusBody(summary, plan, run, results, links, {
    browserstackMissing: opts.browserstackMissing,
    leftOut: opts.leftOut,
    issueCap: opts.issueCap,
  });
  if (status) {
    // Only a title still in the old `[pre-release]` form is rewritten; one a
    // maintainer has edited is left alone.
    const retitle = status.title.startsWith('[pre-release]');
    if (status.body !== body || retitle) {
      await gh.updateIssue(status.number, {
        ...(retitle ? { title: statusTitle } : {}),
        body,
      });
      log(`updated status #${status.number}`);
    }
  } else {
    const created = await gh.createIssue({
      title: statusTitle,
      body,
      labels: ['prerelease', STATUS_LABEL],
    });
    log(`opened status #${created.number}`);
    // A pin is a convenience: failing to pin (say, three issues are pinned
    // already) must not fail the step after every issue was written.
    try {
      await gh.pinIssue(created.node_id);
      log(`pinned status #${created.number}`);
    } catch (err) {
      console.warn(
        `could not pin status #${created.number}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return plan;
}

/** `--issue-cap`: a positive integer, or no cap when absent or empty. */
function parseIssueCap(value: string | undefined): number | undefined {
  const v = (value ?? '').trim();
  if (v === '') return undefined;
  const n = Number(v);
  if (!/^[0-9]+$/.test(v) || n < 1 || !Number.isSafeInteger(n)) {
    throw new Error(`--issue-cap must be a positive integer, not '${v}'`);
  }
  return n;
}

const commaList = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

/** The report's command line, checked before anything is read. */
export function parseCli(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      results: { type: 'string' },
      expected: { type: 'string', default: '' },
      known: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'browserstack-missing': { type: 'boolean', default: false },
      'left-out': { type: 'string', default: '' },
      'issue-cap': { type: 'string' },
    },
  });
  if (!values.results) throw new Error('--results <dir> is required');
  return {
    results: values.results,
    expected: commaList(values.expected),
    known: values.known,
    apply: values.apply === true,
    browserstackMissing: values['browserstack-missing'] === true,
    leftOut: commaList(values['left-out']),
    issueCap: parseIssueCap(values['issue-cap']),
  };
}

async function main(argv: string[]): Promise<void> {
  const cli = parseCli(argv);
  const results = await readResults(cli.results);
  const knownPath =
    cli.known ??
    fileURLToPath(new URL('../../known-failures.json', import.meta.url));
  const { active, expired } = parseKnownFailures(
    JSON.parse(await readFile(knownPath, 'utf8')),
    new Date(),
  );
  for (const e of expired) {
    console.warn(
      `known failure ${e.key} expired on ${e.expires}; reporting it again`,
    );
  }
  const gh = new GitHub();
  if (cli.apply && !gh.hasToken) {
    throw new Error('GITHUB_TOKEN is required with --apply');
  }
  const plan = await reconcile({
    gh,
    results,
    expected: cli.expected,
    apply: cli.apply,
    known: active,
    browserstackMissing: cli.browserstackMissing,
    leftOut: cli.leftOut,
    ...(cli.issueCap === undefined ? {} : { issueCap: cli.issueCap }),
    log: (line) => console.log(line),
  });
  if (!cli.apply) console.log(JSON.stringify(plan, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
