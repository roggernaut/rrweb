import type { Engine } from '../types.ts';
import type { Failure, RunSummary } from './failures.ts';

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

/** Share of the keys that ran which must fail for the run to count as broken. */
export const MASS_FAILURE_SHARE = 0.3;
/** Fewest failing keys that can count as a broken run. */
export const MASS_FAILURE_MIN = 5;

/** Label the reporter puts on an issue it closed after a recovery. */
export const RECOVERED_LABEL = 'prerelease:recovered';

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Open before closed, then the highest number first. */
const preference = (a: ExistingIssue, b: ExistingIssue) =>
  a.state !== b.state ? (a.state === 'open' ? -1 : 1) : b.number - a.number;

/**
 * Decides what to do with the issue tracker after a run. Pure: the caller
 * fetches `existing` and applies the plan.
 *
 * A mass failure (rule 1) yields one `run-broken` action and nothing else.
 * Otherwise each failure is matched by key to an existing issue (rule 2), and
 * an open issue whose key did not fail closes only when every target it
 * recorded as failing ran the check and passed (rule 3). Actions come out
 * ordered by key, then issue number, whatever the order of the inputs.
 */
export function planIssueActions(
  summary: RunSummary,
  existing: ExistingIssue[],
  runBrokenIssue?: ExistingIssue,
): IssuePlan {
  const failures = [...summary.failures].sort((a, b) =>
    compareStrings(a.key, b.key),
  );

  if (
    failures.length >= MASS_FAILURE_MIN &&
    failures.length / summary.totalKeys >= MASS_FAILURE_SHARE
  ) {
    return {
      actions: [
        {
          type: 'run-broken',
          ...(runBrokenIssue ? { issue: runBrokenIssue.number } : {}),
          failures,
        },
      ],
      closedButFailing: [],
    };
  }

  const byKey = new Map<string, ExistingIssue[]>();
  for (const i of existing) byKey.set(i.key, [...(byKey.get(i.key) ?? []), i]);
  for (const issues of byKey.values()) issues.sort(preference);

  const planned: Array<{ key: string; issue: number; action: IssueAction }> =
    [];
  const closedButFailing: IssuePlan['closedButFailing'] = [];
  const failed = new Set<string>();

  for (const failure of failures) {
    failed.add(failure.key);
    const match = byKey.get(failure.key)?.[0];
    const at = { key: failure.key, issue: match?.number ?? 0 };
    if (!match) {
      planned.push({ ...at, action: { type: 'create', failure } });
    } else if (match.state === 'open') {
      planned.push({
        ...at,
        action: { type: 'update', issue: match.number, failure },
      });
    } else if (match.labels.includes(RECOVERED_LABEL)) {
      planned.push({
        ...at,
        action: {
          type: 'reopen',
          issue: match.number,
          failure,
          reason: 'regressed',
        },
      });
    } else if (failure.engines.some((e) => !match.engines.includes(e))) {
      planned.push({
        ...at,
        action: {
          type: 'reopen',
          issue: match.number,
          failure,
          reason: 'spread',
        },
      });
    } else {
      closedButFailing.push({ issue: match.number, key: failure.key });
    }
  }

  for (const [key, issues] of byKey) {
    if (failed.has(key)) continue;
    const passed = summary.passedOn[key] ?? [];
    for (const i of issues) {
      // With no recorded failing target there is no evidence of recovery.
      if (
        i.state === 'open' &&
        i.failingTargets.length > 0 &&
        i.failingTargets.every((t) => passed.includes(t))
      ) {
        planned.push({
          key,
          issue: i.number,
          action: { type: 'close', issue: i.number, key },
        });
      }
    }
  }

  planned.sort((a, b) => compareStrings(a.key, b.key) || a.issue - b.issue);
  return { actions: planned.map((p) => p.action), closedButFailing };
}
