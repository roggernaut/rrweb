import type { CheckOutcome, TargetResult } from '../node/results.ts';
import type { PerfSample } from '../types.ts';

export const RATIO_LIMIT = 1.5;
export const MIN_DIFF_MS = 50;
export const MIN_HEAP_DIFF = 5 * 1024 * 1024;

type Metric = 'durationMs' | 'maxBlockMs' | 'heapDeltaBytes';

export interface PerfFinding {
  targetId: string;
  checkId: string;
  message: string;
}

export function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Every sample's value for `metric`, skipping samples without one. */
function values(samples: PerfSample[], metric: Metric): number[] {
  return samples.flatMap((s) => {
    const x = s[metric];
    return typeof x === 'number' && Number.isFinite(x) ? [x] : [];
  });
}

function performanceChecks(
  r: TargetResult,
): Array<[string, CheckOutcome & { samples: PerfSample[] }]> {
  return Object.entries(r.checks).flatMap(([id, c]) =>
    c.kind === 'performance' && c.samples && c.samples.length > 0
      ? [[id, { ...c, samples: c.samples }] as const]
      : [],
  );
}

/**
 * Performance findings, one per breached limit.
 *
 * - Ceiling: on every target whose `perf` is not 'none', the median longest
 *   block may not exceed that result's own `ceilingMs`, or the scenario's
 *   `ceilingMs` on its outcome when that is higher.
 * - Compare: an upcoming target with `perf: 'compare'` is held against the
 *   stable target of its pair group, metric by metric (the check's `compare`
 *   list, default durationMs). It fails when it is over RATIO_LIMIT times
 *   slower and also over the absolute floor (MIN_DIFF_MS, MIN_HEAP_DIFF).
 *
 * A comparison that cannot be made because the stable side is missing is
 * skipped and pushed to `notes`.
 */
export function evaluatePerf(
  results: TargetResult[],
  notes: string[] = [],
): PerfFinding[] {
  const findings: PerfFinding[] = [];
  for (const r of results) {
    if (r.perf === 'none') continue;
    const checks = performanceChecks(r);

    for (const [checkId, c] of checks) {
      const block = median(values(c.samples, 'maxBlockMs'));
      const ceilingMs = Math.max(r.ceilingMs, c.ceilingMs ?? 0);
      if (block > ceilingMs) {
        findings.push({
          targetId: r.targetId,
          checkId,
          message: `longest block ${Math.round(
            block,
          )} ms over ${ceilingMs} ms ceiling`,
        });
      }
    }

    if (r.perf !== 'compare' || r.channel !== 'upcoming') continue;
    const stable =
      r.pairGroup === undefined
        ? undefined
        : results.find(
            (o) =>
              o.channel === 'stable' &&
              o.pairGroup === r.pairGroup &&
              o.launch.ok,
          );
    for (const [checkId, c] of checks) {
      const stableCheck = stable?.checks[checkId];
      if (!stable || !stableCheck?.samples?.length) {
        notes.push(
          stable
            ? `${checkId}: ${stable.targetId} has no samples, so ${r.targetId} was not compared`
            : `${checkId}: no stable result for pair group ${
                r.pairGroup ?? '(none)'
              }, so ${r.targetId} was not compared`,
        );
        continue;
      }
      for (const metric of c.compare ?? (['durationMs'] as Metric[])) {
        const up = values(c.samples, metric);
        const st = values(stableCheck.samples, metric);
        if (up.length === 0 || st.length === 0) continue; // e.g. no heap numbers
        const u = median(up);
        const s = median(st);
        const minDiff =
          metric === 'heapDeltaBytes' ? MIN_HEAP_DIFF : MIN_DIFF_MS;
        if (u > RATIO_LIMIT * s && u - s > minDiff) {
          findings.push({
            targetId: r.targetId,
            checkId,
            message: `${metric} ${Math.round(u)} vs stable ${Math.round(s)} (${(
              u / s
            ).toFixed(2)}x)`,
          });
        }
      }
    }
  }
  return findings;
}
