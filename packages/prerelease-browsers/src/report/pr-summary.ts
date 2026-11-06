import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { TargetResult } from '../node/results.ts';
import { readResults } from '../node/results.ts';
import type { KnownFailure } from './failures.ts';
import { collectFailures, parseKnownFailures } from './failures.ts';
import {
  capBody,
  cell,
  noMentions,
  reproduceLine,
  untrusted,
} from './render.ts';

/** One finding on one target; `targetId` is the target without its `@role`. */
export interface PrFinding {
  targetId: string;
  key: string;
  message: string;
  reproduce: string;
}

export interface PrVerdict {
  failures: PrFinding[];
  warnings: PrFinding[];
  incomplete: string[];
  markdown: string;
}

type Role = 'pr' | 'base';

const MESSAGE_LIMIT = 1_000;

/** `chrome-stable@pr` as its target and role; an id without a role counts as `pr`. */
function splitRole(id: string): { target: string; role: Role } {
  const m = /^(.*)@(pr|base)$/.exec(id);
  return m ? { target: m[1], role: m[2] as Role } : { target: id, role: 'pr' };
}

const reproduce = (target: string, role: Role, checkId?: string): string =>
  `yarn workspace @rrweb/prerelease-browsers run-target --target ${target} --pr-role ${role}${
    checkId === undefined ? '' : ` --check ${checkId}`
  }`;

/**
 * Judges a pull request run, in which every target ran once as `<id>@pr`
 * with the pull request's rrweb and once as `<id>@base` with the base
 * branch's (see asPrRole).
 *
 * Only a check that fails with the pull request's rrweb, and not with the
 * base branch's on the same target, is a failure. A check failing on both,
 * or only on base, and a browser that did not launch for one role, are
 * warnings. A missing or stopped-early result, or a browser that launched
 * for neither role, makes the run incomplete.
 */
export function summarizePr(
  results: TargetResult[],
  expectedTargets: string[],
  known: KnownFailure[],
): PrVerdict {
  const s = collectFailures(results, expectedTargets, known);
  const failures: PrFinding[] = [];
  const warnings: PrFinding[] = [];

  for (const f of s.failures) {
    const failingOn = new Set(f.targets.map((t) => t.targetId));
    for (const t of f.targets) {
      const { target, role } = splitRole(t.targetId);
      const finding = (message: string): PrFinding => ({
        targetId: target,
        key: f.key,
        message,
        reproduce: reproduce(target, 'pr', f.checkId),
      });
      if (role === 'pr') {
        if (failingOn.has(`${target}@base`)) {
          warnings.push(finding(`also fails on base: ${t.message}`));
        } else {
          failures.push(finding(t.message));
        }
      } else if (!failingOn.has(`${target}@pr`)) {
        warnings.push(finding(`fails only on base: ${t.message}`));
      }
    }
  }

  const notLaunched = new Set(s.launchFailures.map((l) => l.targetId));
  for (const l of s.launchFailures) {
    const { target, role } = splitRole(l.targetId);
    warnings.push({
      targetId: target,
      key: 'launch',
      message: `browser failed to launch: ${l.error}`,
      reproduce: reproduce(target, role),
    });
  }

  const reasons = new Map<string, string>();
  for (const id of s.missingTargets) reasons.set(id, 'no results');
  for (const id of s.incompleteTargets) {
    const reason = results.find((r) => r.targetId === id)?.incompleteReason;
    reasons.set(id, `stopped early${reason ? ` (${reason})` : ''}`);
  }
  for (const id of notLaunched) {
    const { target } = splitRole(id);
    const both = [`${target}@pr`, `${target}@base`];
    if (both.every((b) => notLaunched.has(b))) {
      for (const b of both) {
        reasons.set(b, 'the browser launched with neither build');
      }
    }
  }
  const order = (id: string) => {
    const i = expectedTargets.indexOf(id);
    return i < 0 ? expectedTargets.length : i;
  };
  const incompleteRows = [...reasons].sort(([a], [b]) => order(a) - order(b));
  const incomplete = incompleteRows.map(([id]) => id);

  const verdict =
    failures.length > 0
      ? `Fail: ${failures.length} failing`
      : incomplete.length > 0
      ? 'Incomplete'
      : 'Pass';

  const table = (title: string, rows: PrFinding[]): string[] =>
    rows.length === 0
      ? []
      : [
          `### ${title}`,
          '',
          '| Target | Check | Message | Reproduce |',
          '| --- | --- | --- | --- |',
          ...rows.map(
            (r) =>
              `| ${cell(r.targetId)} | ${cell(r.key)} | ${untrusted(
                r.message,
                MESSAGE_LIMIT,
              )} | ${untrusted(reproduceLine(r.reproduce), MESSAGE_LIMIT)} |`,
          ),
          '',
        ];

  const lines = [
    '## Pre-release browser checks',
    '',
    verdict,
    '',
    "Each target ran the focused checks twice on one runner, with this pull request's rrweb and with the base branch's. Only a check that fails with this pull request's rrweb and passes with the base branch's fails the pull request.",
    '',
    ...table('Failures', failures),
    ...table('Warnings', warnings),
  ];
  if (incomplete.length > 0) {
    lines.push(
      '### Incomplete targets',
      '',
      ...incompleteRows.map(([id, reason]) => `- ${cell(id)}: ${reason}`),
      '',
    );
  }
  if (failures.length > 0 || warnings.length > 0) {
    lines.push(
      'Run a reproduce command from the repository root, after building rrweb.',
      '',
    );
  }

  return {
    failures,
    warnings,
    incomplete,
    markdown: capBody(noMentions(lines.join('\n'))),
  };
}

async function main(argv: string[]): Promise<boolean> {
  const { values } = parseArgs({
    args: argv,
    options: {
      results: { type: 'string' },
      expected: { type: 'string', default: '' },
      known: { type: 'string' },
    },
  });
  if (!values.results) throw new Error('--results <dir> is required');
  const expected = (values.expected ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const knownPath =
    values.known ??
    fileURLToPath(new URL('../../known-failures.json', import.meta.url));
  const { active, expired } = parseKnownFailures(
    JSON.parse(await readFile(knownPath, 'utf8')),
    new Date(),
  );
  for (const e of expired) {
    console.warn(
      `known failure ${e.key} expired on ${e.expires}; reporting it again`,
    );
  }
  const verdict = summarizePr(
    await readResults(values.results),
    expected,
    active,
  );
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) await appendFile(summaryFile, verdict.markdown);
  else console.log(verdict.markdown);
  return verdict.failures.length === 0 && verdict.incomplete.length === 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).then(
    (ok) => {
      if (!ok) process.exitCode = 1;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    },
  );
}
