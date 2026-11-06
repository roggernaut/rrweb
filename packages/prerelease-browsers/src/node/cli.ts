import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { PerfSample } from '../types.ts';
import { runTarget } from './run-targets.ts';
import { applyPortOffset, findTarget } from './targets.ts';

const deadlineMinutes = 105;

const perfMetrics = ['durationMs', 'maxBlockMs', 'heapDeltaBytes'] as const;

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One line per metric: the median, then every sample in run order. */
function describeSamples(samples: PerfSample[]): string[] {
  return perfMetrics.flatMap((metric) => {
    const xs = samples.flatMap((s) => {
      const x = s[metric];
      return x === undefined ? [] : [x];
    });
    if (xs.length === 0) return [];
    const round = (x: number) =>
      metric === 'heapDeltaBytes' ? Math.round(x) : Number(x.toFixed(1));
    return [
      `  ${metric} median ${round(median(xs))} (${xs.map(round).join(', ')})`,
    ];
  });
}

const usage = `usage: cli.ts run-target --target <id> [--check <id>]... [--results <dir>] [--deadline <iso>] [--port-offset <n>]`;

async function runTargetCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      target: { type: 'string' },
      check: { type: 'string', multiple: true },
      results: { type: 'string', default: 'results' },
      deadline: { type: 'string' },
      'port-offset': { type: 'string' },
    },
  });
  if (!values.target) throw new Error(`--target is required\n${usage}`);
  if (values['port-offset'] !== undefined) {
    applyPortOffset(Number(values['port-offset']));
  }
  const deadline = values.deadline
    ? new Date(values.deadline)
    : new Date(Date.now() + deadlineMinutes * 60_000);
  if (Number.isNaN(deadline.getTime())) {
    throw new Error(`--deadline is not a date: ${values.deadline}`);
  }
  const rrwebCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const target = findTarget(values.target);
  const result = await runTarget(target, {
    resultsDir: resolve(values.results ?? 'results'),
    deadline,
    only: values.check,
    rrwebCommit,
  });
  if (!result.launch.ok) {
    console.log(`${target.id} launch failed: ${result.launch.error}`);
  }
  for (const [id, outcome] of Object.entries(result.checks)) {
    const note = outcome.message ? ` ${outcome.message}` : '';
    console.log(`${id} ${outcome.status}${note}`);
    for (const line of describeSamples(outcome.samples ?? []))
      console.log(line);
  }
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'run-target') await runTargetCommand(rest);
  else throw new Error(usage);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
