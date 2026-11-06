import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { PerfSample } from '../types.ts';
import {
  browserStackIds,
  connectWithBackoff,
  credentialsFromEnv,
  fetchCatalogue,
  resolveBrowserStackTargets,
  runPool,
  toTarget,
} from './browserstack.ts';
import type { TargetResult } from './results.ts';
import { errorMessage } from './run-check.ts';
import { runTarget, runTargetOrRecordCrash } from './run-targets.ts';
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

const usage = `usage: cli.ts run-target --target <id> [--check <id>]... [--results <dir>] [--deadline <iso>] [--port-offset <n>]
       cli.ts run-browserstack [--results <dir>] [--deadline <iso>] [--only <id>]...`;

function parseDeadline(value: string | undefined): Date {
  const deadline = value
    ? new Date(value)
    : new Date(Date.now() + deadlineMinutes * 60_000);
  if (Number.isNaN(deadline.getTime())) {
    throw new Error(`--deadline is not a date: ${value}`);
  }
  return deadline;
}

function headCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

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
  const deadline = parseDeadline(values.deadline);
  const rrwebCommit = headCommit();
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

/** The most BrowserStack sessions one run keeps open at once. */
const maxSessions = 5;

/** The session link without its query, which carries an access token. */
function linkWithoutToken(url: string | undefined): string {
  if (!url) return 'no session link';
  try {
    const { origin, pathname } = new URL(url);
    return origin + pathname;
  } catch {
    return 'unreadable session link';
  }
}

/** One line per target: launch, browser, check counts, session and wall time. */
function summarize(r: TargetResult): string {
  const seconds = Math.round(
    (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000,
  );
  if (!r.launch.ok) {
    return `${r.targetId}: launch failed after ${seconds} s: ${r.launch.error}`;
  }
  const counts = new Map<string, number>();
  for (const c of Object.values(r.checks)) {
    counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
  }
  const browser = r.browser
    ? `${r.browser.browserName} ${r.browser.browserVersion}${
        r.browser.device ? ` on ${r.browser.device}` : ''
      }`
    : 'browser unknown';
  const tally = [...counts].map(([s, n]) => `${n} ${s}`).join(', ');
  return `${r.targetId}: ${browser}; ${
    tally || 'no checks'
  }; ${linkWithoutToken(r.sessionUrl)}; ${seconds} s`;
}

async function runBrowserStackCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      results: { type: 'string', default: 'results' },
      deadline: { type: 'string' },
      only: { type: 'string', multiple: true },
    },
  });
  const unknown = (values.only ?? []).filter(
    (id) => !(browserStackIds as readonly string[]).includes(id),
  );
  if (unknown.length > 0) {
    throw new Error(
      `unknown BrowserStack target ${unknown.join(
        ', ',
      )}; known: ${browserStackIds.join(', ')}`,
    );
  }
  const deadline = parseDeadline(values.deadline);
  const resultsDir = resolve(values.results ?? 'results');
  const rrwebCommit = headCommit();

  const specs = resolveBrowserStackTargets(
    await fetchCatalogue(credentialsFromEnv()),
  );
  for (const id of browserStackIds) {
    if (specs.some((s) => s.id === id)) continue;
    console.log(
      id === 'bs-safari-newer'
        ? `${id} left out: the catalogue has no macOS newer than the runner's`
        : `${id} left out: its device is not in the catalogue`,
    );
  }
  const selected = values.only
    ? specs.filter((s) => values.only!.includes(s.id))
    : specs;
  await mkdir(resultsDir, { recursive: true });
  await writeFile(
    join(resultsDir, 'bs-expected.txt'),
    selected.map((s) => `${s.id}\n`).join(''),
  );

  const run = {
    build: `rrweb prerelease ${new Date().toISOString().slice(0, 10)} #${
      process.env.GITHUB_RUN_ID ?? 'local'
    }`,
    playwrightVersion: (
      createRequire(import.meta.url)('playwright/package.json') as {
        version: string;
      }
    ).version,
  };
  const jobs = selected.map((spec) => async () => {
    const target = toTarget(spec, run);
    const waiting = {
      ...target,
      connect: () => connectWithBackoff(target.connect, deadline),
    };
    try {
      const result = await runTargetOrRecordCrash(waiting, {
        resultsDir,
        deadline,
        rrwebCommit,
      });
      console.log(summarize(result));
    } catch (err) {
      // Only writing the results file itself can fail here.
      console.error(`${spec.id}: no results file: ${errorMessage(err)}`);
    }
  });
  await runPool(jobs, maxSessions);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'run-target') await runTargetCommand(rest);
  else if (command === 'run-browserstack') await runBrowserStackCommand(rest);
  else throw new Error(usage);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
