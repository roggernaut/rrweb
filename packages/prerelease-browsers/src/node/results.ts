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
  eventsFile?: string; // relative to the results dir, last failing attempt's events
}

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
  incomplete: boolean; // true when the deadline or a broken protocol stopped work
  incompleteReason?: string; // 'deadline' or 'protocol broken'
  sessionUrl?: string;
  checks: Record<string, CheckOutcome>;
}

/** Writes `<dir>/<targetId>.json`, creating the directory when needed. */
export async function writeResult(dir: string, r: TargetResult): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${r.targetId}.json`),
    JSON.stringify(r, null, 2) + '\n',
  );
}

/** Reads every `<dir>/*.json` target result, sorted by file name. */
export async function readResults(dir: string): Promise<TargetResult[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  return Promise.all(
    names.map(
      async (name) =>
        JSON.parse(await readFile(join(dir, name), 'utf8')) as TargetResult,
    ),
  );
}
