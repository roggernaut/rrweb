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
  /**
   * This run already opened or reopened the issue: the report ran before on
   * the same run. The issue keeps its slot under the per-run cap.
   */
  notifiedThisRun?: boolean;
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

/** A failure the per-run cap kept from opening or reopening its issue. */
export interface HeldBack {
  key: string;
  engines: Engine[];
  targets: string[];
}

export interface IssuePlan {
  actions: IssueAction[];
  closedButFailing: Array<{ issue: number; key: string }>;
  /** In the order they would get a slot. */
  heldBack: HeldBack[];
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

/**
 * Which notifying failure gets a slot first: privacy, then more engines,
 * then more targets, then the lower key.
 */
const priority = (a: Failure, b: Failure) =>
  Number(b.kind === 'privacy') - Number(a.kind === 'privacy') ||
  b.engines.length - a.engines.length ||
  new Set(b.targets.map((t) => t.targetId)).size -
    new Set(a.targets.map((t) => t.targetId)).size ||
  compareStrings(a.key, b.key);

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
 *
 * With a `cap`, at most that many issues open or reopen. Issues this run
 * already opened or reopened (a re-run of the report) hold their slots
 * first; the rest go by `priority`. A failure that gets no slot has no
 * action and is listed in `heldBack`. It still failed, so it closes nothing.
 * Updates, closes and the run-broken actions are never capped.
 */
export function planIssueActions(
  summary: RunSummary,
  existing: ExistingIssue[],
  runBrokenIssue?: ExistingIssue,
  cap?: number,
): IssuePlan {
  if (cap !== undefined && !(Number.isInteger(cap) && cap > 0)) {
    throw new RangeError(
      `the issue cap must be a positive integer, not ${cap}`,
    );
  }
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
      heldBack: [],
    };
  }

  const byKey = new Map<string, ExistingIssue[]>();
  for (const i of existing) byKey.set(i.key, [...(byKey.get(i.key) ?? []), i]);
  for (const issues of byKey.values()) issues.sort(preference);

  type Planned = { key: string; issue: number; action: IssueAction };
  const planned: Planned[] = [];
  const closedButFailing: IssuePlan['closedButFailing'] = [];
  const failed = new Set<string>();
  /** Creates and reopens, which notify; they compete for the cap's slots. */
  const notifying: Array<{ failure: Failure; entry: Planned }> = [];
  let slotsUsed = 0;

  for (const failure of failures) {
    failed.add(failure.key);
    const match = byKey.get(failure.key)?.[0];
    if (!match) {
      notifying.push({
        failure,
        entry: {
          key: failure.key,
          issue: 0,
          action: { type: 'create', failure },
        },
      });
      continue;
    }
    const at = { key: failure.key, issue: match.number };
    const rec = record(failure, match, summary.passedOn[failure.key] ?? []);
    if (match.state === 'open') {
      if (match.notifiedThisRun) slotsUsed++;
      planned.push({
        ...at,
        action: { type: 'update', issue: match.number, failure, ...rec },
      });
    } else if (match.labels.includes(RECOVERED_LABEL)) {
      notifying.push({
        failure,
        entry: {
          ...at,
          action: {
            type: 'reopen',
            issue: match.number,
            failure,
            reason: 'regressed',
            ...rec,
          },
        },
      });
    } else if (failure.engines.some((e) => !match.engines.includes(e))) {
      notifying.push({
        failure,
        entry: {
          ...at,
          action: {
            type: 'reopen',
            issue: match.number,
            failure,
            reason: 'spread',
            ...rec,
          },
        },
      });
    } else {
      closedButFailing.push({ issue: match.number, key: failure.key });
    }
  }

  notifying.sort((a, b) => priority(a.failure, b.failure));
  const slots =
    cap === undefined ? notifying.length : Math.max(0, cap - slotsUsed);
  for (const n of notifying.slice(0, slots)) planned.push(n.entry);
  const heldBack = notifying.slice(slots).map(({ failure }) => ({
    key: failure.key,
    engines: failure.engines,
    targets: sortedUnique(failure.targets.map((t) => t.targetId)),
  }));

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
  return {
    actions: planned.map((p) => p.action),
    closedButFailing,
    heldBack,
  };
}
