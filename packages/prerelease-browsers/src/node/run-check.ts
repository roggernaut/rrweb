import type { AttemptResult, CheckMeta, RunOptions } from '../types.ts';
import type { PageDriver } from './drivers/types.ts';
import { RealmReuseError } from './drivers/types.ts';
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
 * Thrown by a connect that gave up because the run's deadline came, for
 * example while waiting for a free BrowserStack session. runTarget records
 * that as incomplete, not as a launch failure.
 */
export class DeadlineReached extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeadlineReached';
  }
}

export const malformedPoll = 'malformed poll result from driver';

const pollStates: ReadonlySet<unknown> = new Set([
  'idle',
  'running',
  'done',
  'error',
]);

function isPollState(value: unknown): value is PollState {
  return (
    typeof value === 'object' &&
    value !== null &&
    pollStates.has((value as { state?: unknown }).state)
  );
}

/** What a page is built from, and how it reaches the browser. */
export interface PageSource {
  bundle: string;
  rrweb: string;
  /** The fixture server, when one runs. */
  httpOrigin?: string;
  /** 'http' opens every check from the fixture server; see TargetDefinition. */
  loadVia?: 'html' | 'http';
}

/**
 * Set on each page opened over http. Finding it right after the next open
 * means the engine kept the old Window, so globals one check replaced would
 * leak into the next.
 */
const httpLoadMarker = '__prerelease_http_load';
const checkHttpLoad = `(() => {
  const kept = window.${httpLoadMarker} === true;
  window.${httpLoadMarker} = true;
  return kept;
})()`;

const timedOut = /^timed out after \d+ ms$/;
/** How Playwright and WebDriver say the browser session has gone away. */
const closedSession =
  /Target page, context or browser has been closed|invalid session id|Session not started or terminated/i;

/** True for a failed attempt that lost its browser session. */
export function isSessionClosed(result: AttemptResult): boolean {
  return !result.ok && closedSession.test(result.message ?? '');
}

/**
 * True for a failed attempt that says nothing about rrweb: it timed out, the
 * driver mangled the page protocol, or the browser session went away.
 */
export function isProtocolFailure(result: AttemptResult): boolean {
  return (
    !result.ok &&
    (result.message === malformedPoll ||
      timedOut.test(result.message ?? '') ||
      isSessionClosed(result))
  );
}

/**
 * Runs one attempt of one check: load the page, start the check, poll until
 * it settles, then read the result back in chunks. The page comes from the
 * fixture server when the check needs http or `src.loadVia` is 'http', and
 * is written into a blank page otherwise.
 */
export async function runAttempt(
  driver: PageDriver,
  meta: CheckMeta,
  src: PageSource,
  opts: RunOptions & { timeoutMs: number },
): Promise<AttemptResult> {
  if (meta.needsHttp && (!src.httpOrigin || !driver.canReachLocalhost)) {
    return { ok: true, skipped: 'needs http' };
  }
  if (src.loadVia === 'http' && !src.httpOrigin) {
    throw new Error(`cannot load ${meta.id} over http: no fixture server`);
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
    if (meta.needsHttp || src.loadVia === 'http') {
      // A real navigation, which should give the page a new Window.
      await call(driver.open(`${String(src.httpOrigin)}/check/${meta.id}`));
      if ((await call(driver.evaluate<unknown>(checkHttpLoad))) === true) {
        throw new RealmReuseError(
          'opening a check over http kept the previous Window; pages would share globals',
        );
      }
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
        driver.evaluate<unknown>('__prerelease.poll()'),
      );
      // A garbled answer would otherwise read as "still running" until the
      // attempt times out.
      if (!isPollState(status)) return { ok: false, message: malformedPoll };
      if (status.state === 'error') {
        return { ok: false, message: status.error ?? 'check failed' };
      }
      if (status.state === 'done') {
        return JSON.parse(
          await readResult(status.length ?? 0),
        ) as AttemptResult;
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
  const message = err instanceof Error ? err.message : String(err);
  // Playwright prefixes the same closed-page error again on every call.
  return message.replace(/^([\w.]+: )\1+/, '$1');
}

const pastDeadline = (deadline?: Date) =>
  deadline !== undefined && Date.now() >= deadline.getTime();

/**
 * Applies the 2-of-3 rule: stop at a first pass, at two failures, or after a
 * third attempt breaks the tie. A failure no attempt contradicts stays a
 * failure, even when the other attempts skipped. No attempt starts once `deadline` has passed;
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
    if (!result.ok) {
      failures++;
    } else if (!result.skipped) {
      passes++;
    } else if (attempts.length === 1) {
      return { status: 'skipped', attempts };
    } // A skip on a retry says nothing either way, so it counts as neither.
    if (passes === 1 && failures === 0) return { status: 'pass', attempts };
    if (failures === 2) return { status: 'fail', attempts };
  }
  return { status: passes > 0 ? 'flaky' : 'fail', attempts };
}

/**
 * Takes `samples` samples of one performance scenario, each on a fresh page.
 * There is no retry rule: the scenario fails when two samples error (or its
 * single sample does), is flaky when one of several does, and otherwise
 * passes, leaving the limits to the report. No sample starts once `deadline`
 * has passed; a scenario stopped that way is `not-run`, keeping the samples
 * it took.
 */
export async function runScenario(
  driver: PageDriver,
  meta: CheckMeta,
  src: PageSource,
  opts: {
    samples: number;
    timeoutMs: number;
    scale?: number;
    deadline?: Date;
    onAttempt?: (result: AttemptResult) => void;
  },
): Promise<CheckOutcome> {
  const outcome: CheckOutcome = {
    kind: meta.kind,
    status: 'pass',
    attempts: 0,
    samples: [],
    compare: meta.compare ?? ['durationMs'],
    attemptMs: [],
  };
  const samples = outcome.samples!;
  const errorLimit = Math.min(2, opts.samples);
  let errors = 0;
  while (outcome.attempts < opts.samples) {
    if (pastDeadline(opts.deadline)) {
      outcome.status = 'not-run';
      break;
    }
    const startedAt = Date.now();
    const result = await runAttempt(driver, meta, src, {
      timeoutMs: opts.timeoutMs,
      scale: opts.scale,
    }).catch((err): AttemptResult => {
      // Not the scenario's fault, and every later sample would hit it too.
      if (err instanceof RealmReuseError) throw err;
      return { ok: false, message: errorMessage(err) };
    });
    outcome.attemptMs!.push(Date.now() - startedAt);
    outcome.attempts++;
    opts.onAttempt?.(result);
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
  if (errors > 0 && outcome.status === 'pass') outcome.status = 'flaky';
  return outcome;
}
