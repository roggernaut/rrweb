import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CheckKind, Engine, PerfSample } from '../types.ts';
import type { BrowserInfo } from './drivers/types.ts';

export type CheckStatus = 'pass' | 'fail' | 'flaky' | 'skipped' | 'not-run';

export interface CheckOutcome {
  kind: CheckKind;
  status: CheckStatus;
  message?: string; // from the last failing attempt
  attempts: number;
  samples?: PerfSample[]; // performance only
  compare?: Array<'durationMs' | 'maxBlockMs' | 'heapDeltaBytes'>; // performance only
  ceilingMs?: number; // performance only: the scenario's own ceiling, when it has one, at least the target's
  eventsFile?: string; // relative to the results dir, last failing attempt's events
}

/**
 * Why a target stopped early: the run's deadline came, the driver garbled the
 * page protocol, or the driver could not give pages a fresh Window.
 */
export type IncompleteReason =
  | 'deadline'
  | 'protocol broken'
  | 'fresh window unavailable';

export interface TargetResult {
  schema: 1;
  targetId: string;
  engine: Engine;
  channel: 'upcoming' | 'stable';
  pairGroup?: string;
  perf: 'compare' | 'ceiling-only' | 'none';
  ceilingMs: number; // default 1000
  browser?: BrowserInfo;
  launch: { ok: true } | { ok: false; error: string };
  rrwebCommit: string;
  startedAt: string;
  finishedAt: string;
  incomplete: boolean; // true when something stopped work early
  incompleteReason?: IncompleteReason;
  sessionUrl?: string;
  checks: Record<string, CheckOutcome>;
}

const isObject = (x: unknown): x is object =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Writes `<dir>/<targetId>.json`, creating the directory when needed. */
export async function writeResult(dir: string, r: TargetResult): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${r.targetId}.json`),
    JSON.stringify(r, null, 2) + '\n',
  );
}

/**
 * Reads every `<dir>/*.json` target result, sorted by file name. A missing
 * directory reads as no results. A file that is not valid JSON, not schema 1,
 * or lacks its `launch` or `checks` object is skipped with a warning, so the target shows up as missing in the report
 * instead of failing the whole run.
 */
export async function readResults(dir: string): Promise<TargetResult[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const results: TargetResult[] = [];
  for (const name of names) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(join(dir, name), 'utf8'),
      );
      if (!isObject(parsed) || (parsed as { schema?: unknown }).schema !== 1) {
        console.warn(`skipping ${name}: not a schema 1 target result`);
        continue;
      }
      const { launch, checks } = parsed as Partial<TargetResult>;
      if (!isObject(launch) || !isObject(checks)) {
        console.warn(`skipping ${name}: no launch or checks object`);
        continue;
      }
      results.push(parsed as TargetResult);
    } catch (err) {
      console.warn(`skipping ${name}: ${(err as Error).message}`);
    }
  }
  return results;
}
