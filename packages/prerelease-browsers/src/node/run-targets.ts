import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { driverProbe, checks as registeredChecks } from '../page/registry.ts';
import type { AttemptResult, CheckKind, CheckMeta } from '../types.ts';
import type { BrowserInfo, PageDriver } from './drivers/types.ts';
import { RealmReuseError } from './drivers/types.ts';
import type { FixtureServer } from './fixture-server.ts';
import { startFixtureServer } from './fixture-server.ts';
import { buildPageBundle, readRrwebUmd } from './page-source.ts';
import type {
  CheckOutcome,
  IncompleteReason,
  TargetResult,
} from './results.ts';
import { writeResult } from './results.ts';
import type { PageSource } from './run-check.ts';
import {
  DeadlineReached,
  errorMessage,
  isProtocolFailure,
  runAttempt,
  runScenario,
  runWithRetry,
} from './run-check.ts';
import type { TargetDefinition } from './targets.ts';

/**
 * Consecutive checks whose every failed attempt timed out or got a garbled
 * poll before the target stops: past that the driver, not rrweb, is broken,
 * and each further check would only burn its timeouts.
 */
const brokenChecksLimit = 2;

const functionalTimeoutMs = 60_000;
const performanceTimeoutMs = 180_000;
/** For the driver probe, which settles at once on a working driver. */
const probeTimeoutMs = 30_000;

const probeMeta: CheckMeta = {
  id: driverProbe.id,
  kind: driverProbe.kind,
  tier: driverProbe.tier,
};

function attemptTimeoutMs(kind: CheckKind): number {
  return kind === 'performance' ? performanceTimeoutMs : functionalTimeoutMs;
}

/** Plain metadata for every registered check, without the in-page code. */
function checkMetas(): CheckMeta[] {
  return registeredChecks.map(
    ({ run: _run, beforeRrweb: _beforeRrweb, ...meta }) => meta,
  );
}

/** Throws when any of `ids` names no registered check. */
export function assertKnownChecks(ids: string[]): void {
  const metas = checkMetas();
  const unknown = ids.filter((id) => !metas.some((m) => m.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `unknown check ${unknown
        .map((id) => `"${id}"`)
        .join(', ')}; known checks: ${metas.map((m) => m.id).join(', ')}`,
    );
  }
}

function selectChecks(t: TargetDefinition, only?: string[]): CheckMeta[] {
  let metas = checkMetas();
  if (only) {
    assertKnownChecks(only);
    metas = metas.filter((m) => only.includes(m.id));
  }
  if (t.checks === 'focused') metas = metas.filter((m) => m.tier === 'focused');
  if (t.checks === 'functional-privacy' || t.perf === 'none') {
    metas = metas.filter((m) => m.kind !== 'performance');
  }
  return metas;
}

/** A result for `t` with no checks run yet, its launch counted as ok. */
export function newResult(
  t: TargetDefinition,
  rrwebCommit: string,
): TargetResult {
  return {
    schema: 1,
    targetId: t.id,
    engine: t.engine,
    channel: t.channel,
    ...(t.pairGroup === undefined ? {} : { pairGroup: t.pairGroup }),
    perf: t.perf,
    ceilingMs: t.ceilingMs ?? 1000,
    launch: { ok: true },
    rrwebCommit,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    incomplete: false,
    checks: {},
  };
}

/**
 * Runs every selected check on one target and writes its results file. A
 * browser that will not launch, or an attempt that throws, is recorded in
 * the result instead of aborting the run.
 */
export async function runTarget(
  t: TargetDefinition,
  opts: {
    resultsDir: string;
    deadline: Date;
    only?: string[];
    rrwebCommit: string;
    /** The rrweb build to test, for both composed pages and the fixture server. */
    rrwebDist?: string;
  },
): Promise<TargetResult> {
  const metas = selectChecks(t, opts.only);
  const result = newResult(t, opts.rrwebCommit);

  /** Marks every check not yet run as not-run and the result incomplete. */
  function stopHere(reason: IncompleteReason): void {
    for (const meta of metas) {
      result.checks[meta.id] ??= {
        kind: meta.kind,
        status: 'not-run',
        attempts: 0,
      };
    }
    result.incomplete = true;
    result.incompleteReason ??= reason;
  }

  // Past the deadline no session opens: it would only run nothing.
  if (Date.now() >= opts.deadline.getTime()) {
    stopHere('deadline');
    return finish(result, opts.resultsDir);
  }

  let driver: PageDriver;
  try {
    driver = await t.connect();
  } catch (err) {
    if (err instanceof DeadlineReached) stopHere('deadline');
    else result.launch = { ok: false, error: errorMessage(err) };
    return finish(result, opts.resultsDir);
  }

  const loadVia = t.loadVia ?? 'html';
  if (loadVia === 'http' && !driver.canReachLocalhost) {
    await driver.close().catch(() => undefined);
    result.launch = {
      ok: false,
      error: `${t.id} loads checks over http from this machine, but its driver cannot reach this machine`,
    };
    return finish(result, opts.resultsDir);
  }

  let server: FixtureServer | undefined;
  try {
    result.browser = await describeBrowser(driver);
    const bundle = await buildPageBundle();
    const rrweb = readRrwebUmd(opts.rrwebDist);
    if (
      loadVia === 'http' ||
      (driver.canReachLocalhost && metas.some((m) => m.needsHttp))
    ) {
      server = await startFixtureServer({ bundle, rrweb });
    }
    const src: PageSource = {
      bundle,
      rrweb,
      httpOrigin: server?.origin,
      loadVia,
    };
    /** The checks in the current run of driver-broken ones. */
    let brokenInARow: CheckOutcome[] = [];
    for (const meta of metas) {
      let checked: Awaited<ReturnType<typeof runCheck>>;
      try {
        checked = await runCheck(meta, src);
      } catch (err) {
        // No load on this driver can get a fresh Window, so every check
        // left would fail for that alone: stop, and blame no check.
        if (!(err instanceof RealmReuseError)) throw err;
        stopHere('fresh window unavailable');
        break;
      }
      const { outcome, broken } = checked;
      result.checks[meta.id] = outcome;
      // runCheck leaves a check not-run only at the deadline.
      if (outcome.status === 'not-run') {
        stopHere('deadline');
        break;
      }
      // A skip never touched the browser, so it says nothing either way.
      if (outcome.status === 'skipped') continue;
      brokenInARow = broken ? [...brokenInARow, outcome] : [];
      if (brokenInARow.length >= brokenChecksLimit) {
        // A page that does nothing but load settles on a working driver:
        // then rrweb hangs, which is a failure like any other, and the
        // target goes on.
        if (await driverWorks(src)) {
          brokenInARow = [];
          continue;
        }
        // The driver broke, not rrweb: the checks that showed it did not
        // really run. They keep their attempts and message for the status
        // issue, but open no issue.
        for (const tripped of brokenInARow) tripped.status = 'not-run';
        stopHere('protocol broken');
        break;
      }
    }
    result.sessionUrl = await markSession(driver, result);
  } finally {
    await server?.close().catch(() => undefined);
    await driver.close().catch(() => undefined);
  }
  return finish(result, opts.resultsDir);

  /** True when the probe page loads and settles through `src`'s load path. */
  async function driverWorks(src: PageSource): Promise<boolean> {
    try {
      const probe = await runAttempt(driver, probeMeta, src, {
        timeoutMs: probeTimeoutMs * t.timeScale,
      });
      return probe.ok && probe.skipped === undefined;
    } catch {
      return false;
    }
  }

  async function runCheck(
    meta: CheckMeta,
    src: PageSource,
  ): Promise<{ outcome: CheckOutcome; broken: boolean }> {
    const timeoutMs = attemptTimeoutMs(meta.kind) * t.timeScale;
    /** A failed check whose failures all came from the driver, not rrweb. */
    const brokenBy = (outcome: CheckOutcome, attempts: AttemptResult[]) => {
      const failed = attempts.filter((a) => !a.ok);
      return (
        outcome.status === 'fail' &&
        failed.length > 0 &&
        failed.every(isProtocolFailure)
      );
    };
    if (meta.kind === 'performance') {
      const samples: AttemptResult[] = [];
      const outcome = await runScenario(driver, meta, src, {
        samples: t.perfSamples,
        timeoutMs,
        deadline: opts.deadline,
        onAttempt: (a) => samples.push(a),
      });
      if (meta.ceilingMs !== undefined) {
        outcome.ceilingMs = Math.max(result.ceilingMs, meta.ceilingMs);
      }
      return { outcome, broken: brokenBy(outcome, samples) };
    }
    const { status, attempts } = await runWithRetry(
      () =>
        runAttempt(driver, meta, src, { timeoutMs }).catch(
          (err): AttemptResult => {
            if (err instanceof RealmReuseError) throw err;
            return { ok: false, message: errorMessage(err) };
          },
        ),
      opts.deadline,
    );
    const failed = attempts.filter((a) => !a.ok);
    const lastFailure = failed.at(-1);
    const outcome: CheckOutcome = {
      kind: failedAs(meta.kind, status, failed),
      status,
      attempts: attempts.length,
    };
    if (lastFailure?.message !== undefined)
      outcome.message = lastFailure.message;
    if (status === 'skipped') outcome.message = attempts[0].skipped;
    if (lastFailure?.events) {
      outcome.eventsFile = `${t.id}/${meta.id}.events.json`;
      const file = join(opts.resultsDir, outcome.eventsFile);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(lastFailure.events));
    }
    return { outcome, broken: brokenBy(outcome, attempts) };
  }
}

/**
 * The kind a check is filed under: for a failed check, the kind its failed
 * attempts named, if they all named the same one; otherwise the check's own.
 * A privacy check whose public control went missing is a functional failure,
 * but a single leak among its failed attempts keeps it a privacy one.
 */
function failedAs(
  kind: CheckKind,
  status: CheckOutcome['status'],
  failed: AttemptResult[],
): CheckKind {
  const override = failed.at(-1)?.kind;
  if (status !== 'fail' || override === undefined) return kind;
  return failed.every((a) => a.kind === override) ? override : kind;
}

/**
 * runTarget, except that a crash around the checks, such as an unreadable
 * rrweb build, is written as a launch failure instead of thrown, so the
 * target always leaves a results file.
 */
export async function runTargetOrRecordCrash(
  t: TargetDefinition,
  opts: Parameters<typeof runTarget>[1],
): Promise<TargetResult> {
  const startedAt = new Date().toISOString();
  try {
    return await runTarget(t, opts);
  } catch (err) {
    const result = newResult(t, opts.rrwebCommit);
    result.startedAt = startedAt;
    result.launch = { ok: false, error: `crashed: ${errorMessage(err)}` };
    return finish(result, opts.resultsDir);
  }
}

async function describeBrowser(
  driver: PageDriver,
): Promise<BrowserInfo | undefined> {
  try {
    return await driver.describe();
  } catch {
    return undefined;
  }
}

/** Tells the driver how the target went and returns its session link, if any. */
async function markSession(
  driver: PageDriver,
  result: TargetResult,
): Promise<string | undefined> {
  try {
    const failed = Object.entries(result.checks).filter(
      ([, c]) => c.status === 'fail',
    );
    const incomplete = result.incomplete
      ? `incomplete: ${result.incompleteReason ?? 'unknown reason'}`
      : undefined;
    await driver.markSession?.(
      failed.length === 0 && incomplete === undefined,
      failed.length > 0
        ? `failed: ${failed.map(([id]) => id).join(', ')}`
        : incomplete ?? 'all checks passed',
    );
    return await driver.sessionUrl?.();
  } catch {
    return undefined;
  }
}

async function finish(
  result: TargetResult,
  resultsDir: string,
): Promise<TargetResult> {
  result.finishedAt = new Date().toISOString();
  if (result.sessionUrl === undefined) delete result.sessionUrl;
  await writeResult(resultsDir, result);
  return result;
}
