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

/**
 * What an updated or reopened issue's marker should record: this run's
 * failing targets plus the issue's earlier ones that have not since passed,
 * so a target that went missing or incomplete cannot drop out unconfirmed.
 */
export interface IssueRecord {
  recordTargets: string[]; // sorted, unique
  recordEngines: Engine[]; // sorted, unique
}

export type IssueAction =
  | { type: 'create'; failure: Failure }
  | ({ type: 'update'; issue: number; failure: Failure } & IssueRecord)
  | ({
      type: 'reopen';
      issue: number;
      failure: Failure;
      reason: 'regressed' | 'spread';
    } & IssueRecord)
  | { type: 'close'; issue: number; key: string }
  /** A closed issue (say by a fixing PR) whose failing targets all passed. */
  | { type: 'mark-recovered'; issue: number; key: string }
  | { type: 'run-broken'; issue?: number; failures: Failure[] }
  /** The open run-broken issue, after a complete run that was not broken. */
  | { type: 'close-run-broken'; issue: number };

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

const sortedUnique = <T extends string>(xs: T[]): T[] =>
  [...new Set(xs)].sort(compareStrings);

function record(
  failure: Failure,
  issue: ExistingIssue,
  passed: string[],
): IssueRecord {
  const failing = failure.targets.map((t) => t.targetId);
  const carried = issue.failingTargets.filter(
    (t) => !passed.includes(t) && !failing.includes(t),
  );
  return {
    recordTargets: sortedUnique([...failing, ...carried]),
    recordEngines: sortedUnique([
      ...failure.engines,
      ...(carried.length > 0 ? issue.engines : []),
    ]),
  };
}

/** Every recorded failing target ran the check and passed. */
const confirmedPassing = (issue: ExistingIssue, passed: string[]) =>
  issue.failingTargets.length > 0 &&
  issue.failingTargets.every((t) => passed.includes(t));

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
 * recorded as failing ran the check and passed (rule 3); a closed issue in that
 * state without the recovered label is marked recovered, so a later failure
 * reopens it. An open run-broken issue closes after a complete run that was
 * not broken; missing or incomplete targets keep it open. Actions come out
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
    if (!match) {
      planned.push({
        key: failure.key,
        issue: 0,
        action: { type: 'create', failure },
      });
      continue;
    }
    const at = { key: failure.key, issue: match.number };
    const rec = record(failure, match, summary.passedOn[failure.key] ?? []);
    if (match.state === 'open') {
      planned.push({
        ...at,
        action: { type: 'update', issue: match.number, failure, ...rec },
      });
    } else if (match.labels.includes(RECOVERED_LABEL)) {
      planned.push({
        ...at,
        action: {
          type: 'reopen',
          issue: match.number,
          failure,
          reason: 'regressed',
          ...rec,
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
          ...rec,
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
      if (!confirmedPassing(i, passed)) continue;
      if (i.state === 'open') {
        planned.push({
          key,
          issue: i.number,
          action: { type: 'close', issue: i.number, key },
        });
      } else if (!i.labels.includes(RECOVERED_LABEL)) {
        planned.push({
          key,
          issue: i.number,
          action: { type: 'mark-recovered', issue: i.number, key },
        });
      }
    }
  }

  if (
    runBrokenIssue?.state === 'open' &&
    summary.missingTargets.length === 0 &&
    summary.incompleteTargets.length === 0
  ) {
    planned.push({
      key: runBrokenIssue.key,
      issue: runBrokenIssue.number,
      action: { type: 'close-run-broken', issue: runBrokenIssue.number },
    });
  }

  planned.sort((a, b) => compareStrings(a.key, b.key) || a.issue - b.issue);
  return { actions: planned.map((p) => p.action), closedButFailing };
}
