import type { AttemptResult, CheckMeta, RunOptions } from '../types.ts';
import type { PageDriver } from './drivers/types.ts';
import type { CheckStatus } from './results.ts';
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

/**
 * Applies the 2-of-3 rule: stop at a first pass, at two failures, or after a
 * third attempt breaks the tie.
 */
export async function runWithRetry(
  attempt: () => Promise<AttemptResult>,
): Promise<{ status: CheckStatus; attempts: AttemptResult[] }> {
  const attempts: AttemptResult[] = [];
  let failures = 0;
  let passes = 0;
  while (attempts.length < 3) {
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
