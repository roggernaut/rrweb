import type { AttemptResult, CheckMeta, RunOptions } from '../types.ts';
import type { PageDriver } from './drivers/types.ts';
import type { CheckOutcome, CheckStatus } from './results.ts';
import { composePage } from './page-source.ts';

const pollIntervalMs = 250;

interface PollState {
  state: 'idle' | 'running' | 'done' | 'error';
  length?: number;
  error?: string;
}

class AttemptTimeout extends Error {}

/**
 * Runs one attempt of one check: load the page, start the check, poll until
 * it settles, then read the result back in chunks.
 */
export async function runAttempt(
  driver: PageDriver,
  meta: CheckMeta,
  src: { bundle: string; rrweb: string; httpOrigin?: string },
  opts: RunOptions & { timeoutMs: number },
): Promise<AttemptResult> {
  if (meta.needsHttp && (!src.httpOrigin || !driver.canReachLocalhost)) {
    return { ok: true, skipped: 'needs http' };
  }
  const deadline = Date.now() + opts.timeoutMs;
  // Each driver call is bounded too, so a frozen page still times out.
  const call = <T>(promise: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new AttemptTimeout()),
        Math.max(0, deadline - Date.now()),
      );
    });
    promise.catch(() => undefined);
    return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
  };

  try {
    if (meta.needsHttp) {
      await call(driver.open(`${src.httpOrigin}/check/${meta.id}`));
    } else {
      await call(driver.loadHtml(composePage(meta, src.bundle, src.rrweb)));
    }
    const id = JSON.stringify(meta.id);
    if (!meta.startDuringLoad) {
      const options: RunOptions = {
        disableMasking: opts.disableMasking,
        scale: opts.scale,
      };
      await call(
        driver.evaluate(
          `void __prerelease.start(${id}, ${JSON.stringify(options)})`,
        ),
      );
    }
    for (;;) {
      const status = await call(
        driver.evaluate<PollState>('__prerelease.poll()'),
      );
      if (status.state === 'error') {
        return { ok: false, message: status.error ?? 'check failed' };
      }
      if (status.state === 'done') {
        return JSON.parse(await readResult(status.length ?? 0));
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new AttemptTimeout();
      await new Promise((r) => setTimeout(r, Math.min(pollIntervalMs, left)));
    }
  } catch (err) {
    if (err instanceof AttemptTimeout) {
      return { ok: false, message: `timed out after ${opts.timeoutMs} ms` };
    }
    throw err;
  }

  async function readResult(length: number): Promise<string> {
    let json = '';
    while (json.length < length) {
      const chunk = await call(
        driver.evaluate<string>(`__prerelease.read(${json.length})`),
      );
      if (!chunk) {
        throw new Error(`result read stalled at ${json.length} of ${length}`);
      }
      json += chunk;
    }
    return json;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const pastDeadline = (deadline?: Date) =>
  deadline !== undefined && Date.now() >= deadline.getTime();

/**
 * Applies the 2-of-3 rule: stop at a first pass, at two failures, or after a
 * third attempt breaks the tie. No attempt starts once `deadline` has passed;
 * a check stopped that way is `not-run`, keeping the attempts it took.
 */
export async function runWithRetry(
  attempt: () => Promise<AttemptResult>,
  deadline?: Date,
): Promise<{ status: CheckStatus; attempts: AttemptResult[] }> {
  const attempts: AttemptResult[] = [];
  let failures = 0;
  let passes = 0;
  while (attempts.length < 3) {
    if (pastDeadline(deadline)) return { status: 'not-run', attempts };
    const result = await attempt();
    attempts.push(result);
    if (result.ok) {
      if (result.skipped && attempts.length === 1) {
        return { status: 'skipped', attempts };
      }
      passes++;
    } else {
      failures++;
    }
    if (passes === 1 && failures === 0) return { status: 'pass', attempts };
    if (failures === 2) return { status: 'fail', attempts };
  }
  return { status: passes === 2 ? 'flaky' : 'fail', attempts };
}

/**
 * Takes `samples` samples of one performance scenario, each on a fresh page.
 * There is no retry rule: the scenario fails only when two samples error (or
 * its single sample does), and otherwise passes with every sample, leaving
 * the limits to the report. No sample starts once `deadline` has passed; a
 * scenario stopped that way is `not-run`, keeping the samples it took.
 */
export async function runScenario(
  driver: PageDriver,
  meta: CheckMeta,
  src: { bundle: string; rrweb: string; httpOrigin?: string },
  opts: { samples: number; timeoutMs: number; scale?: number; deadline?: Date },
): Promise<CheckOutcome> {
  const outcome: CheckOutcome = {
    kind: meta.kind,
    status: 'pass',
    attempts: 0,
    samples: [],
    compare: meta.compare ?? ['durationMs'],
  };
  const samples = outcome.samples!;
  const errorLimit = Math.min(2, opts.samples);
  let errors = 0;
  while (outcome.attempts < opts.samples) {
    if (pastDeadline(opts.deadline)) {
      outcome.status = 'not-run';
      break;
    }
    const result = await runAttempt(driver, meta, src, {
      timeoutMs: opts.timeoutMs,
      scale: opts.scale,
    }).catch(
      (err): AttemptResult => ({ ok: false, message: errorMessage(err) }),
    );
    outcome.attempts++;
    if (result.skipped !== undefined && outcome.attempts === 1) {
      return { ...outcome, status: 'skipped', message: result.skipped };
    }
    if (result.ok && result.sample) {
      samples.push(result.sample);
      continue;
    }
    outcome.message = result.ok
      ? 'scenario returned no sample'
      : result.message ?? 'scenario failed';
    if (++errors >= errorLimit) {
      outcome.status = 'fail';
      break;
    }
  }
  return outcome;
}
