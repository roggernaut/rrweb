import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { TargetResult } from '../node/results.ts';
import { readResults } from '../node/results.ts';
import type { KnownFailure } from './failures.ts';
import { evaluatePerf } from './compare.ts';
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

/** What made a check count as failing on one target. */
type FindingKind = 'fail' | 'ceiling' | 'ratio';

interface Part {
  kind: FindingKind;
  message: string;
}

/**
 * Every finding per `<targetId>\0<checkId>`, the way collectFailures builds
 * its messages: the check's own failure, then each performance limit it
 * breached. A ratio finding compares the PR build with base, so it only ever
 * appears on `@pr`.
 */
function findingParts(results: TargetResult[]): Map<string, Part[]> {
  const parts = new Map<string, Part[]>();
  const add = (targetId: string, checkId: string, part: Part) => {
    const id = `${targetId}\0${checkId}`;
    parts.set(id, [...(parts.get(id) ?? []), part]);
  };
  const counted = (targetId: string, checkId: string) => {
    const r = results.find((x) => x.targetId === targetId);
    const status = r?.launch.ok ? r.checks[checkId]?.status : undefined;
    return status !== undefined && status !== 'skipped' && status !== 'not-run';
  };
  for (const r of results) {
    if (!r.launch.ok) continue;
    for (const [checkId, c] of Object.entries(r.checks)) {
      if (c.status === 'fail') {
        add(r.targetId, checkId, {
          kind: 'fail',
          message: c.message ?? 'check failed',
        });
      }
    }
  }
  for (const f of evaluatePerf(results)) {
    if (!counted(f.targetId, f.checkId)) continue;
    add(f.targetId, f.checkId, {
      kind: f.message.startsWith('longest block ') ? 'ceiling' : 'ratio',
      message: f.message,
    });
  }
  return parts;
}

/**
 * Judges a pull request run, in which every target ran once as `<id>@pr`
 * with the pull request's rrweb and once as `<id>@base` with the base
 * branch's (see asPrRole).
 *
 * A finding with the pull request's rrweb is a failure unless base has a
 * finding of the same kind on the same check and target: a check failure on
 * both, or a ceiling breach on both, is only a warning. A slowdown against
 * base is never excused. Findings only on base, and a browser that did not
 * launch with the base rrweb, are warnings. A missing or stopped-early
 * result, or a browser that did not launch with the pull request's rrweb,
 * makes the run incomplete.
 */
export function summarizePr(
  results: TargetResult[],
  expectedTargets: string[],
  known: KnownFailure[],
): PrVerdict {
  const s = collectFailures(results, expectedTargets, known);
  const parts = findingParts(results);
  const partsOf = (targetId: string, checkId: string) =>
    parts.get(`${targetId}\0${checkId}`) ?? [];
  const notLaunched = new Set(s.launchFailures.map((l) => l.targetId));
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
      const join = (ps: Part[]) => ps.map((p) => p.message).join('; ');
      if (role === 'pr') {
        const mine = partsOf(t.targetId, f.checkId);
        const onBase = failingOn.has(`${target}@base`)
          ? partsOf(`${target}@base`, f.checkId)
          : [];
        const shared = mine.filter((p) =>
          onBase.some((b) => b.kind === p.kind),
        );
        const own = mine.filter((p) => !shared.includes(p));
        if (own.length > 0 || mine.length === 0) {
          failures.push(finding(own.length > 0 ? join(own) : t.message));
        }
        if (shared.length > 0) {
          warnings.push(finding(`also fails on base: ${join(shared)}`));
        }
      } else if (!notLaunched.has(`${target}@pr`)) {
        const onPr = failingOn.has(`${target}@pr`)
          ? partsOf(`${target}@pr`, f.checkId)
          : [];
        const only = partsOf(t.targetId, f.checkId).filter(
          (b) => !onPr.some((p) => p.kind === b.kind),
        );
        if (only.length > 0) {
          warnings.push(finding(`fails only on base: ${join(only)}`));
        }
      }
    }
  }

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
    reasons.set(
      id,
      `stopped early${
        reason ? ` (${untrusted(reason, MESSAGE_LIMIT, false)})` : ''
      }`,
    );
  }
  for (const id of notLaunched) {
    const { target, role } = splitRole(id);
    if (notLaunched.has(`${target}@base`) && notLaunched.has(`${target}@pr`)) {
      reasons.set(id, 'the browser launched with neither build');
    } else if (role === 'pr') {
      reasons.set(
        id,
        "the browser didn't launch with this pull request's rrweb",
      );
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
  if (s.notes.length > 0) {
    lines.push(
      '### Notes',
      '',
      ...s.notes.map((n) => `- ${untrusted(n, MESSAGE_LIMIT, false)}`),
      '',
    );
  }
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
