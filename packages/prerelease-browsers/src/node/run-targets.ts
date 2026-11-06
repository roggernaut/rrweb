import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { checks as registeredChecks } from '../page/registry.ts';
import type { AttemptResult, CheckKind, CheckMeta } from '../types.ts';
import type { BrowserInfo, PageDriver } from './drivers/types.ts';
import { buildPageBundle, readRrwebUmd } from './page-source.ts';
import type { CheckOutcome, TargetResult } from './results.ts';
import { writeResult } from './results.ts';
import { runAttempt, runWithRetry } from './run-check.ts';
import type { TargetDefinition } from './targets.ts';

const functionalTimeoutMs = 60_000;
const performanceTimeoutMs = 180_000;

function attemptTimeoutMs(kind: CheckKind): number {
  return kind === 'performance' ? performanceTimeoutMs : functionalTimeoutMs;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  const result: TargetResult = {
    schema: 1,
    targetId: t.id,
    engine: t.engine,
    channel: t.channel,
    ...(t.pairGroup === undefined ? {} : { pairGroup: t.pairGroup }),
    perf: t.perf,
    ceilingMs: t.ceilingMs ?? 1000,
    launch: { ok: true },
    rrwebCommit: opts.rrwebCommit,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    incomplete: false,
    checks: {},
  };

  let driver: PageDriver;
  try {
    driver = await t.connect();
  } catch (err) {
    result.launch = { ok: false, error: errorMessage(err) };
    return finish(result, opts.resultsDir);
  }

  try {
    result.browser = await describeBrowser(driver);
    const src = { bundle: await buildPageBundle(), rrweb: readRrwebUmd() };
    for (const meta of metas) {
      const outcome = await runCheck(meta, src);
      result.checks[meta.id] = outcome;
      if (outcome.status === 'not-run') result.incomplete = true;
    }
    result.sessionUrl = await markSession(driver, result);
  } finally {
    await driver.close().catch(() => undefined);
  }
  return finish(result, opts.resultsDir);

  async function runCheck(
    meta: CheckMeta,
    src: { bundle: string; rrweb: string },
  ): Promise<CheckOutcome> {
    const notRun: CheckOutcome = {
      kind: meta.kind,
      status: 'not-run',
      attempts: 0,
    };
    if (Date.now() >= opts.deadline.getTime()) return notRun;
    // Performance scenarios arrive with runScenario; until then they never run.
    if (meta.kind === 'performance') return notRun;
    const timeoutMs = attemptTimeoutMs(meta.kind) * t.timeScale;
    const { status, attempts } = await runWithRetry(() =>
      runAttempt(driver, meta, src, { timeoutMs }).catch(
        (err): AttemptResult => ({ ok: false, message: errorMessage(err) }),
      ),
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
    return outcome;
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
