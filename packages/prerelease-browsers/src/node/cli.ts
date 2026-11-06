import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runTarget } from './run-targets.ts';
import { findTarget } from './targets.ts';

const deadlineMinutes = 105;

const usage = `usage: cli.ts run-target --target <id> [--check <id>]... [--results <dir>] [--deadline <iso>]`;

async function runTargetCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      target: { type: 'string' },
      check: { type: 'string', multiple: true },
      results: { type: 'string', default: 'results' },
      deadline: { type: 'string' },
    },
  });
  if (!values.target) throw new Error(`--target is required\n${usage}`);
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
