import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { checks as registeredChecks } from '../page/registry.ts';
import type { AttemptResult, CheckKind, CheckMeta } from '../types.ts';
import type { BrowserInfo, PageDriver } from './drivers/types.ts';
import type { FixtureServer } from './fixture-server.ts';
import { startFixtureServer } from './fixture-server.ts';
import { buildPageBundle, readRrwebUmd } from './page-source.ts';
import type { CheckOutcome, TargetResult } from './results.ts';
import { writeResult } from './results.ts';
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

function attemptTimeoutMs(kind: CheckKind): number {
  return kind === 'performance' ? performanceTimeoutMs : functionalTimeoutMs;
}

/** Plain metadata for every registered check, without the in-page code. */
function checkMetas(): CheckMeta[] {
  return registeredChecks.map(
    ({ run: _run, beforeRrweb: _beforeRrweb, ...meta }) => meta,
  );
}

function selectChecks(t: TargetDefinition, only?: string[]): CheckMeta[] {
  let metas = checkMetas();
  if (only) {
    const unknown = only.filter((id) => !metas.some((m) => m.id === id));
    if (unknown.length > 0) {
      throw new Error(
        `unknown check ${unknown
          .map((id) => `"${id}"`)
          .join(', ')}; known checks: ${metas.map((m) => m.id).join(', ')}`,
      );
    }
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
  },
): Promise<TargetResult> {
  const metas = selectChecks(t, opts.only);
  const result = newResult(t, opts.rrwebCommit);

  /** Marks every check not yet run as not-run and the result incomplete. */
  function stopHere(reason: string): void {
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

  let server: FixtureServer | undefined;
  try {
    result.browser = await describeBrowser(driver);
    const bundle = await buildPageBundle();
    const rrweb = readRrwebUmd();
    if (driver.canReachLocalhost && metas.some((m) => m.needsHttp)) {
      server = await startFixtureServer({ bundle, rrweb });
    }
    const src = { bundle, rrweb, httpOrigin: server?.origin };
    let brokenInARow = 0;
    for (const meta of metas) {
      const { outcome, broken } = await runCheck(meta, src);
      result.checks[meta.id] = outcome;
      // runCheck leaves a check not-run only at the deadline.
      if (outcome.status === 'not-run') {
        stopHere('deadline');
        break;
      }
      // A skip never touched the browser, so it says nothing either way.
      if (outcome.status === 'skipped') continue;
      brokenInARow = broken ? brokenInARow + 1 : 0;
      if (brokenInARow >= brokenChecksLimit) {
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

  async function runCheck(
    meta: CheckMeta,
    src: { bundle: string; rrweb: string; httpOrigin?: string },
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
      return { outcome, broken: brokenBy(outcome, samples) };
    }
    const { status, attempts } = await runWithRetry(
      () =>
        runAttempt(driver, meta, src, { timeoutMs }).catch(
          (err): AttemptResult => ({ ok: false, message: errorMessage(err) }),
        ),
      opts.deadline,
    );
    const outcome: CheckOutcome = {
      kind: meta.kind,
      status,
      attempts: attempts.length,
    };
    const lastFailure = attempts.filter((a) => !a.ok).at(-1);
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
    await driver.markSession?.(
      failed.length === 0,
      failed.length === 0
        ? 'all checks passed'
        : `failed: ${failed.map(([id]) => id).join(', ')}`,
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
