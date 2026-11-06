import type { TargetResult } from '../node/results.ts';
import type { BrowserInfo } from '../node/drivers/types.ts';
import type { CheckKind, Engine } from '../types.ts';
import { evaluatePerf } from './compare.ts';

export interface KnownFailure {
  key: string;
  engines?: Engine[]; // absent: every engine
  upstream: string;
  expires: string;
  note?: string;
}

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
  /** key -> targets where the check ran and passed; keys that never passed are absent. */
  passedOn: Record<string, string[]>;
  totalKeys: number; // distinct keys that ran (pass, fail or flaky) on any target
  notes: string[];
}

const keyPattern = /^[a-z0-9-]+:(functional|privacy|performance)$/;
const engineNames: Engine[] = ['chromium', 'gecko', 'webkit'];
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates known-failures.json and splits it by expiry. An entry dated
 * YYYY-MM-DD is active through the end of that day (UTC). Throws on the first
 * malformed entry, so a typo cannot silently park nothing.
 */
export function parseKnownFailures(
  json: unknown,
  now: Date,
): { active: KnownFailure[]; expired: KnownFailure[] } {
  if (!Array.isArray(json)) {
    throw new Error('known-failures.json must be an array');
  }
  const active: KnownFailure[] = [];
  const expired: KnownFailure[] = [];
  json.forEach((raw: unknown, i) => {
    const where = `known-failures.json entry ${i}`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`${where} must be an object`);
    }
    const e = raw as Record<string, unknown>;
    if (typeof e.key !== 'string' || !keyPattern.test(e.key)) {
      throw new Error(
        `${where}: key must look like <check-id>:<functional|privacy|performance>, got ${JSON.stringify(
          e.key,
        )}`,
      );
    }
    if (typeof e.upstream !== 'string') {
      throw new Error(`${where}: upstream must be a string`);
    }
    let url: URL | undefined;
    try {
      url = new URL(e.upstream);
    } catch {
      // reported below
    }
    if (url?.protocol !== 'https:') {
      throw new Error(`${where}: upstream must be an https: URL`);
    }
    if (typeof e.expires !== 'string' || Number.isNaN(Date.parse(e.expires))) {
      throw new Error(`${where}: expires is not a valid date`);
    }
    if (
      e.engines !== undefined &&
      (!Array.isArray(e.engines) ||
        e.engines.some((x) => !engineNames.includes(x as Engine)))
    ) {
      throw new Error(
        `${where}: engines must be a list of ${engineNames.join(', ')}`,
      );
    }
    if (e.note !== undefined && typeof e.note !== 'string') {
      throw new Error(`${where}: note must be a string`);
    }
    const entry: KnownFailure = {
      key: e.key,
      ...(e.engines === undefined ? {} : { engines: e.engines as Engine[] }),
      upstream: e.upstream,
      expires: e.expires,
      ...(e.note === undefined ? {} : { note: e.note }),
    };
    const endMs =
      Date.parse(e.expires) + (dateOnly.test(e.expires) ? 24 * 3600_000 : 0);
    (now.getTime() >= endMs ? expired : active).push(entry);
  });
  return { active, expired };
}

/** run-target knows only the GitHub-runner targets; BrowserStack ids go through run-browserstack. */
const reproduceCommand = (targetId: string, checkId: string) =>
  targetId.startsWith('bs-')
    ? `yarn workspace @rrweb/prerelease-browsers run-browserstack --only ${targetId} --check ${checkId}`
    : `yarn workspace @rrweb/prerelease-browsers run-target --target ${targetId} --check ${checkId}`;

function buildFailure(
  key: string,
  checkId: string,
  kind: CheckKind,
  targets: FailureTarget[],
): Failure {
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
 * Turns a directory of target results into one run summary.
 *
 * A target whose launch failed runs no checks, so it contributes only a
 * launch failure. An incomplete target contributes the checks that did run:
 * a failure on it counts, a check that never ran does not. A performance
 * pass that `evaluatePerf` flags is a performance failure.
 */
export function collectFailures(
  results: TargetResult[],
  expectedTargets: string[],
  known: KnownFailure[],
): RunSummary {
  const notes: string[] = [];
  const present = new Set(results.map((r) => r.targetId));
  const sorted = [...results].sort((a, b) =>
    a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0,
  );

  const summary: RunSummary = {
    failures: [],
    parked: [],
    flaky: [],
    launchFailures: [],
    missingTargets: expectedTargets.filter((id) => !present.has(id)),
    incompleteTargets: sorted
      .filter((r) => r.incomplete)
      .map((r) => r.targetId),
    passedOn: {},
    totalKeys: 0,
    notes,
  };

  const perfMessages = new Map<string, string[]>();
  for (const f of evaluatePerf(results, notes)) {
    const id = `${f.targetId}\0${f.checkId}`;
    perfMessages.set(id, [...(perfMessages.get(id) ?? []), f.message]);
  }

  const ran = new Set<string>();
  const byKey = new Map<string, Failure>();
  for (const r of sorted) {
    if (!r.launch.ok) {
      summary.launchFailures.push({
        targetId: r.targetId,
        error: r.launch.error,
      });
      continue;
    }
    for (const [checkId, c] of Object.entries(r.checks)) {
      if (c.status === 'skipped' || c.status === 'not-run') continue;
      const key = `${checkId}:${c.kind}`;
      ran.add(key);

      const messages: string[] = [];
      if (c.status === 'fail') messages.push(c.message ?? 'check failed');
      if (c.kind === 'performance') {
        messages.push(...(perfMessages.get(`${r.targetId}\0${checkId}`) ?? []));
      }

      if (messages.length === 0) {
        if (c.status === 'flaky') {
          summary.flaky.push({ key, targetId: r.targetId });
        } else {
          (summary.passedOn[key] ??= []).push(r.targetId);
          // A privacy check whose public control went missing was filed
          // under functional; this pass clears that failure too.
          if (c.kind === 'privacy') {
            (summary.passedOn[`${checkId}:functional`] ??= []).push(r.targetId);
          }
        }
        continue;
      }

      const target: FailureTarget = {
        targetId: r.targetId,
        engine: r.engine,
        channel: r.channel,
        ...(r.browser ? { browser: r.browser } : {}),
        message: messages.join('; '),
        ...(c.eventsFile ? { eventsFile: c.eventsFile } : {}),
        ...(r.sessionUrl ? { sessionUrl: r.sessionUrl } : {}),
        reproduce: reproduceCommand(r.targetId, checkId),
      };
      const existing = byKey.get(key);
      if (existing) existing.targets.push(target);
      else byKey.set(key, buildFailure(key, checkId, c.kind, [target]));
    }
  }
  summary.totalKeys = ran.size;

  for (const key of [...byKey.keys()].sort()) {
    const failure = byKey.get(key)!;
    let remaining = failure.targets;
    for (const entry of known.filter((k) => k.key === key)) {
      const covered = remaining.filter(
        (t) => !entry.engines || entry.engines.includes(t.engine),
      );
      if (covered.length === 0) continue;
      remaining = remaining.filter((t) => !covered.includes(t));
      summary.parked.push({
        failure: buildFailure(key, failure.checkId, failure.kind, covered),
        entry,
      });
    }
    if (remaining.length > 0) {
      summary.failures.push(
        buildFailure(key, failure.checkId, failure.kind, remaining),
      );
    }
  }
  return summary;
}
