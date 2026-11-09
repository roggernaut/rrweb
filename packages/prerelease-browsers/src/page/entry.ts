import type { AttemptResult, CheckMeta, RunOptions } from '../types.ts';
import { createContext, withPageError } from './harness.ts';
import { checks, findCheck } from './registry.ts';

/** Largest string `read` returns, in UTF-16 code units. */
const chunkUnits = 200_000;

type State = 'idle' | 'running' | 'done' | 'error';

interface Protocol {
  version: 1;
  list(): CheckMeta[];
  beforeRrweb(id: string): void;
  start(id: string, options: RunOptions): void;
  poll(): { state: State; length?: number; error?: string };
  read(offset: number): string;
}

declare global {
  interface Window {
    __prerelease: Protocol;
  }
}

let state: State = 'idle';
let result = '';
let error: string | undefined;

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    return String(reason);
  }
}

// Listen from bundle load, so errors from beforeRrweb and from rrweb's own
// evaluation, both before start, still fail the run. The first one is enough.
let pageError: string | undefined;
window.addEventListener('error', (event: ErrorEvent) => {
  pageError ??= event.error ? messageOf(event.error) : event.message;
});
window.addEventListener('unhandledrejection', (event) => {
  pageError ??= messageOf(event.reason);
});

async function run(id: string, options: RunOptions): Promise<void> {
  try {
    const check = findCheck(id);
    if (!check) throw new Error(`unknown check: ${id}`);
    let outcome: AttemptResult = await check.run(createContext(options));
    // Read after the check settles, so a late rejection is caught too.
    if (pageError !== undefined) {
      outcome = withPageError(outcome, pageError);
    }
    result = JSON.stringify(outcome);
    state = 'done';
  } catch (err) {
    error = messageOf(err);
    state = 'error';
  }
}

window.__prerelease = {
  version: 1,
  list() {
    return checks.map(({ beforeRrweb: _b, run: _r, ...meta }) => meta);
  },
  beforeRrweb(id) {
    findCheck(id)?.beforeRrweb?.();
  },
  start(id, options) {
    if (state === 'running') throw new Error('a check is already running');
    state = 'running';
    result = '';
    error = undefined;
    // A macrotask, so no check code runs inside the caller's evaluate.
    setTimeout(() => void run(id, options), 0);
  },
  poll() {
    if (state === 'done') return { state, length: result.length };
    if (state === 'error') return { state, error };
    return { state };
  },
  read(offset) {
    let end = Math.min(offset + chunkUnits, result.length);
    const last = result.charCodeAt(end - 1);
    // Never split a surrogate pair: drivers replace lone surrogates.
    if (end < result.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    return result.slice(offset, end);
  },
};
