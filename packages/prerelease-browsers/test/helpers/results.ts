import type {
  CheckOutcome,
  IncompleteReason,
  TargetResult,
} from '../../src/node/results.ts';
import type {
  Failure,
  FailureTarget,
  RunSummary,
} from '../../src/report/failures.ts';
import type { ExistingIssue, IssuePlan } from '../../src/report/issues-plan.ts';
import type { CheckKind, Engine } from '../../src/types.ts';

/** Optional overrides; each is derived from the target id when absent. */
export interface ResultOpts {
  channel?: 'upcoming' | 'stable';
  pairGroup?: string;
  engine?: Engine;
  checkId?: string;
  ceilingMs?: number;
  where?: TargetResult['where'];
  compare?: Array<'durationMs' | 'maxBlockMs' | 'heapDeltaBytes'>;
}

const engines: Record<string, Engine> = {
  chrome: 'chromium',
  edge: 'chromium',
  bs: 'chromium',
  firefox: 'gecko',
  safari: 'webkit',
};

function base(
  targetId: string,
  opts: ResultOpts,
  checks: Record<string, CheckOutcome>,
): TargetResult {
  const prefix = targetId.split('-')[0];
  return {
    schema: 1,
    targetId,
    engine: opts.engine ?? engines[prefix] ?? 'chromium',
    channel:
      opts.channel ?? (targetId.endsWith('-stable') ? 'stable' : 'upcoming'),
    pairGroup: opts.pairGroup ?? prefix,
    ...(opts.where ? { where: opts.where } : {}),
    perf: 'none',
    ceilingMs: opts.ceilingMs ?? 1000,
    launch: { ok: true },
    rrwebCommit: 'abc123',
    startedAt: '2026-11-06T00:00:00.000Z',
    finishedAt: '2026-11-06T00:10:00.000Z',
    incomplete: false,
    checks,
  };
}

/** A `compare` target whose perf check took `durationsMs` per sample. */
export function perf(
  targetId: string,
  channel: 'upcoming' | 'stable',
  durationsMs: number[],
  opts: ResultOpts = {},
): TargetResult {
  const r = base(
    targetId,
    { ...opts, channel },
    {
      [opts.checkId ?? 'perf-snapshot-5k']: {
        kind: 'performance',
        status: 'pass',
        attempts: durationsMs.length,
        samples: durationsMs.map((durationMs) => ({
          durationMs,
          maxBlockMs: 10,
        })),
        ...(opts.compare ? { compare: opts.compare } : {}),
      },
    },
  );
  r.perf = 'compare';
  return r;
}

/** A target whose perf check had the given longest blocks, one per sample. */
export function perfBlock(
  targetId: string,
  mode: 'compare' | 'ceiling-only',
  blocksMs: number[],
  opts: ResultOpts = {},
): TargetResult {
  const r = base(targetId, opts, {
    [opts.checkId ?? 'perf-snapshot-5k']: {
      kind: 'performance',
      status: 'pass',
      attempts: blocksMs.length,
      samples: blocksMs.map((maxBlockMs) => ({ durationMs: 100, maxBlockMs })),
    },
  });
  r.perf = mode;
  return r;
}

/** A target on which one functional check failed all three attempts. */
export function failing(
  targetId: string,
  checkId: string,
  opts: ResultOpts = {},
): TargetResult {
  return base(targetId, opts, {
    [checkId]: {
      kind: 'functional',
      status: 'fail',
      attempts: 3,
      message: `${checkId} broke`,
    },
  });
}

/** A target on which one functional check passed. */
export function passing(
  targetId: string,
  checkId: string,
  opts: ResultOpts = {},
): TargetResult {
  return base(targetId, opts, {
    [checkId]: { kind: 'functional', status: 'pass', attempts: 1 },
  });
}

/** A target whose browser never launched, so no check ran. */
export function launchFailed(
  targetId: string,
  error: string,
  opts: ResultOpts = {},
): TargetResult {
  const r = base(targetId, opts, {});
  r.launch = { ok: false, error };
  return r;
}

/** A target stopped early; its one check did not run. */
export function incomplete(
  targetId: string,
  opts: ResultOpts & { reason?: string } = {},
): TargetResult {
  const r = base(targetId, opts, {
    [opts.checkId ?? 'css-nested-rules']: {
      kind: 'functional',
      status: 'not-run',
      attempts: 0,
    },
  });
  r.incomplete = true;
  // Any string: results files are read back untrusted.
  r.incompleteReason = (opts.reason ?? 'deadline') as IncompleteReason;
  return r;
}

export const ids = (rs: TargetResult[]): string[] => rs.map((r) => r.targetId);

const engineOf = (targetId: string): Engine =>
  engines[targetId.split('-')[0]] ?? 'chromium';

/** A failure of `key` (`<check-id>:<kind>`) on the given targets. */
export function fail(key: string, targetIds: string[]): Failure {
  const [checkId, kind] = key.split(':') as [string, CheckKind];
  const targets: FailureTarget[] = [...targetIds].sort().map((targetId) => ({
    targetId,
    engine: engineOf(targetId),
    channel: targetId.endsWith('-stable') ? 'stable' : 'upcoming',
    message: `${checkId} broke`,
    reproduce: targetId.startsWith('bs-')
      ? `yarn workspace @rrweb/prerelease-browsers run-browserstack --only ${targetId} --check ${checkId}`
      : `yarn workspace @rrweb/prerelease-browsers run-target --target ${targetId} --check ${checkId}`,
  }));
  return {
    key,
    checkId,
    kind,
    targets,
    engines: [...new Set(targets.map((t) => t.engine))].sort(),
    alsoFailsOnStable: targets.some((t) => t.channel === 'stable'),
  };
}

/**
 * A run summary with the given failures (sorted by key). `totalKeys` defaults
 * to the distinct keys among the failures, `passedOn` and `flaky`.
 */
export function summary(
  failures: Failure[],
  overrides: Partial<RunSummary> = {},
): RunSummary {
  const s: RunSummary = {
    failures: [...failures].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    ),
    parked: [],
    flaky: [],
    launchFailures: [],
    missingTargets: [],
    incompleteTargets: [],
    passedOn: {},
    totalKeys: 0,
    notes: [],
    ...overrides,
  };
  if (overrides.totalKeys === undefined) {
    s.totalKeys = new Set([
      ...s.failures.map((f) => f.key),
      ...Object.keys(s.passedOn),
      ...s.flaky.map((f) => f.key),
    ]).size;
  }
  return s;
}

/** An existing issue as parsed from its body marker. */
export function issue(
  number: number,
  state: 'open' | 'closed',
  key: string,
  issueEngines: Engine[],
  failingTargets: string[],
  labels: string[] = [],
): ExistingIssue {
  return {
    number,
    state,
    labels,
    body: `issue ${number} for ${key}`,
    key,
    engines: issueEngines,
    failingTargets,
  };
}

/**
 * The issues as they stand after `plan` is applied, the way the reconciler
 * applies it: markers rewritten from the recorded targets and engines, auto
 * closes and mark-recovered adding `prerelease:recovered`, reopens dropping it.
 * Created issues get the next free number. Run-broken actions are ignored.
 */
export function applyPlan(
  issues: ExistingIssue[],
  plan: IssuePlan,
): ExistingIssue[] {
  const next = issues.map((i) => ({ ...i, labels: [...i.labels] }));
  const find = (n: number) => next.find((i) => i.number === n)!;
  const recovered = 'prerelease:recovered';
  for (const a of plan.actions) {
    if (a.type === 'create') {
      next.push({
        number: Math.max(0, ...next.map((i) => i.number)) + 1,
        state: 'open',
        labels: [],
        body: `issue for ${a.failure.key}`,
        key: a.failure.key,
        engines: [...a.failure.engines],
        failingTargets: a.failure.targets.map((t) => t.targetId),
      });
    } else if (a.type === 'update' || a.type === 'reopen') {
      const i = find(a.issue);
      i.state = 'open';
      i.engines = [...a.recordEngines];
      i.failingTargets = [...a.recordTargets];
      i.labels = i.labels.filter((l) => l !== recovered);
    } else if (a.type === 'close' || a.type === 'mark-recovered') {
      const i = find(a.issue);
      i.state = 'closed';
      if (!i.labels.includes(recovered)) i.labels.push(recovered);
    }
  }
  return next;
}

/**
 * The first line after a body's hidden markers and the blank line that
 * follows them, failing the test when the body does not start that way.
 */
export function countLine(body: string): string {
  const lines = body.split('\n');
  let i = 0;
  while (/^<!-- prerelease:[^\s>]+ -->$/.test(lines[i] ?? '')) i++;
  expect(i).toBeGreaterThan(0);
  expect(lines[i]).toBe('');
  return lines[i + 1];
}
