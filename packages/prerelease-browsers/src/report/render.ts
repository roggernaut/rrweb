import type { TargetResult } from '../node/results.ts';
import type { Engine } from '../types.ts';
import type { Failure, RunSummary } from './failures.ts';
import type { IssuePlan, IssueRecord } from './issues-plan.ts';

export interface RunMeta {
  runUrl: string;
  date: string; // YYYY-MM-DD
  rrwebCommit: string;
  /**
   * GITHUB_RUN_ID. Without it (a local run) the run URL is not unique, so
   * bodies get no notified marker of this run's own.
   */
  runId?: string;
}

/** What the count line at the top of every body this run writes says. */
export interface RunCount {
  /** Failing checks after parking, held-back ones included. */
  failing: number;
  /** How many of them the per-run issue cap held back. */
  heldBack: number;
  cap?: number;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** The visible line right after a body's markers. */
export function runCountLine(c: RunCount): string {
  const line = `**This run found ${plural(
    c.failing,
    'failing check',
    'failing checks',
  )}.**`;
  return c.heldBack > 0 && c.cap !== undefined
    ? `${line} ${c.heldBack} ${
        c.heldBack === 1 ? 'was' : 'were'
      } held back by the per-run cap of ${c.cap}.`
    : line;
}

export const STATUS_MARKER = '<!-- prerelease:status -->';
export const RUN_BROKEN_MARKER = '<!-- prerelease:run-broken -->';
const HISTORY_OPEN = '<!-- prerelease:history -->';
const HISTORY_CLOSE = '<!-- /prerelease:history -->';

/** GitHub allows 65,536 characters; stay well clear of it. */
export const MAX_BODY = 60_000;
/** Raw message length on the first pass, before any escaping. */
const MESSAGE_LIMIT = 2_000;
const SHORT_MESSAGE = 500;
const HISTORY_ROWS = 10;
const engineNames: Engine[] = ['chromium', 'gecko', 'webkit'];

/**
 * An `@` followed by a letter or digit would mention a user, org or team when
 * the body is saved (names can start with a digit), so every edit would
 * notify someone. An empty HTML comment between the two keeps it inert.
 */
export const noMentions = (text: string): string =>
  text.replace(/@(?=[a-z0-9])/gi, '@<!-- -->');

/** At most `limit` characters, keeping surrogate pairs whole. */
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = limit;
  const unit = text.charCodeAt(end - 1);
  if (unit >= 0xd800 && unit <= 0xdbff) end--;
  return text.slice(0, end) + '…';
}

/**
 * Untrusted text (messages, launch errors, notes, browser strings) as one
 * inline code span, so links, images and `owner/repo#n` references never
 * render. Inside a code span an HTML comment would show verbatim, so a
 * mention-shaped `@` becomes a full-width `＠` instead, and `<!--` is broken
 * up so the text cannot forge a marker. In a table, `|` stays escaped.
 */
export function untrusted(text: string, limit: number, inTable = true): string {
  let t = truncate(text, limit)
    .replace(/`/g, "'")
    .replace(/<!--/g, '< !--')
    .replace(/@(?=[a-z0-9])/gi, '＠')
    .replace(/\r?\n|\r/g, ' ⏎ ');
  if (inTable) t = t.replace(/\|/g, '\\|');
  return t.trim() === '' ? '–' : '`' + t + '`';
}

const TRUNCATED =
  "_This body was truncated to fit GitHub's size limit; the run's artifacts hold everything._";

/**
 * A hard cap, measured on the final text: cut on a line boundary, close an
 * open code block, and say so. Markers sit at the top, so they survive.
 */
export function capBody(body: string, max = MAX_BODY): string {
  if (body.length <= max) return body;
  const room = max - TRUNCATED.length - 8;
  const nl = body.lastIndexOf('\n', room);
  let kept = body.slice(0, nl > 0 ? nl : room);
  if ((kept.match(/^```/gm) ?? []).length % 2 === 1) kept += '\n```';
  return `${kept}\n\n${TRUNCATED}\n`;
}

/** Trusted short text in a table cell: no HTML, no column breaks, one line. */
export function cell(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

const code = (text: string) => '`' + text.replace(/`/g, "'") + '`';

/** A session link without its query string, which can carry a share token. */
function sessionLink(url: string | undefined): string {
  if (!url) return '–';
  try {
    const { origin, pathname } = new URL(url);
    return `[session](${origin}${pathname})`;
  } catch {
    return '–';
  }
}

export const runLink = (run: RunMeta): string =>
  `[the run of ${run.date}](${run.runUrl})`;

/**
 * The reproduce command, runnable from the repository root. The workspace
 * name starts with `@`, and the escape `noMentions` adds would show verbatim
 * inside a code block, so the command goes through the package directory.
 */
export const reproduceLine = (command: string): string =>
  command.replace(
    /^yarn workspace @rrweb\/prerelease-browsers /,
    'yarn --cwd packages/prerelease-browsers ',
  );

export function parseMarkers(body: string): {
  key?: string;
  engines: Engine[];
  targets: string[];
  history: string[];
  /** The run that last opened or reopened the issue. */
  notified?: string;
} {
  const key = /<!-- prerelease:key=([^\s>]+) -->/.exec(body)?.[1];
  const notified = /<!-- prerelease:notified=([^\s>]+) -->/.exec(body)?.[1];
  const list = (name: string) =>
    (new RegExp(`<!-- prerelease:${name}=([^\\s>]*) -->`).exec(body)?.[1] ?? '')
      .split(',')
      .filter((x) => x !== '');
  const open = body.indexOf(HISTORY_OPEN);
  // A capped body may have lost the closing marker: read to the end.
  const close = open < 0 ? -1 : body.indexOf(HISTORY_CLOSE, open);
  const history =
    open < 0
      ? []
      : body
          .slice(open + HISTORY_OPEN.length, close < 0 ? undefined : close)
          .split('\n')
          .filter((l) => l.startsWith('| ') && !/^\| (Date|---) /.test(l));
  return {
    ...(key ? { key } : {}),
    ...(notified ? { notified } : {}),
    engines: list('engines').filter((e): e is Engine =>
      engineNames.includes(e as Engine),
    ),
    targets: list('targets'),
    history,
  };
}

export function issueTitle(f: Failure): string {
  return `[pre-release] ${f.kind}: ${f.checkId} fails on ${f.engines.join(
    ', ',
  )}`;
}

export function labelsFor(f: Failure): string[] {
  return [
    'prerelease',
    `prerelease:${f.kind}`,
    ...f.engines.map((e) => `engine:${e}`),
    ...(f.kind === 'privacy' ? ['privacy', 'severity:critical'] : []),
    ...(f.alsoFailsOnStable ? ['prerelease:also-fails-on-stable'] : []),
  ];
}

const historyRow = (run: RunMeta) => `| ${run.date} | [run](${run.runUrl}) |`;

/**
 * The issue for one failing check, opening with `count`. For an update or a
 * reopen, `prior.body` is the issue's current body and `prior.record` is what
 * the markers keep: the planner's recorded targets and engines, which can
 * include earlier targets this run did not confirm. The history carries over
 * from the prior body, newest first, and a re-run of the same run replaces
 * its row instead of adding one. The notified marker names this run on a
 * create or a reopen (none for a run without an id), and carries over on an
 * update.
 */
export function issueBody(
  f: Failure,
  run: RunMeta,
  count: RunCount,
  prior: { body?: string; record?: IssueRecord; reopened?: boolean } = {},
): string {
  const { body: previousBody, record } = prior;
  const notified =
    previousBody === undefined || prior.reopened
      ? run.runId === undefined
        ? undefined
        : run.runUrl
      : parseMarkers(previousBody).notified;
  const recordTargets =
    record?.recordTargets ??
    [...new Set(f.targets.map((t) => t.targetId))].sort();
  const recordEngines = record?.recordEngines ?? f.engines;
  const failingNow = f.targets.map((t) => t.targetId);
  const carried = recordTargets.filter((t) => !failingNow.includes(t));

  const row = `${historyRow(run)} ${code(run.rrwebCommit)} | ${failingNow
    .map((t) => cell(t))
    .join(', ')} |`;
  const earlier = (
    previousBody ? parseMarkers(previousBody).history : []
  ).filter((r) => !r.startsWith(historyRow(run)));
  const history = [row, ...earlier].slice(0, HISTORY_ROWS);

  const build = (messageLimit: number, rows: string[]) => {
    const lines = [
      `<!-- prerelease:key=${f.key} -->`,
      `<!-- prerelease:engines=${recordEngines.join(',')} -->`,
      `<!-- prerelease:targets=${recordTargets.join(',')} -->`,
      ...(notified ? [`<!-- prerelease:notified=${notified} -->`] : []),
      '',
      runCountLine(count),
      '',
      `${code(f.checkId)} (${f.kind}) fails on ${recordEngines.join(
        ', ',
      )} in ${runLink(run)}, with rrweb at commit ${code(run.rrwebCommit)}.`,
      '',
      '| Target | Browser | Platform or device | Message | Session |',
      '| --- | --- | --- | --- | --- |',
      ...f.targets.map((t) =>
        [
          '',
          cell(t.targetId),
          t.browser
            ? untrusted(
                `${t.browser.browserName} ${t.browser.browserVersion}`,
                SHORT_MESSAGE,
              )
            : '–',
          t.browser
            ? untrusted(
                t.browser.device
                  ? `${t.browser.device} (${t.browser.platform})`
                  : t.browser.platform,
                SHORT_MESSAGE,
              )
            : '–',
          untrusted(t.message, messageLimit),
          sessionLink(t.sessionUrl),
          '',
        ]
          .join(' | ')
          .trim(),
      ),
      '',
    ];
    if (carried.length > 0) {
      lines.push(
        `Still tracked from earlier runs, not confirmed passing since: ${carried
          .map((t) => cell(t))
          .join(', ')}.`,
        '',
      );
    }
    if (f.kind === 'privacy') {
      lines.push(
        'Content that rrweb should mask or block appeared in the recording.',
        '',
      );
    }
    if (f.alsoFailsOnStable) {
      lines.push(
        'It fails on a stable browser too, which points at rrweb or the check rather than the browser.',
        '',
      );
    }
    const events = f.targets.flatMap((t) =>
      t.eventsFile ? [code(t.eventsFile)] : [],
    );
    lines.push(
      '### Reproduce',
      '',
      'From the repository root, after building rrweb:',
      '',
      '```bash',
      ...f.targets.map((t) => reproduceLine(t.reproduce)),
      '```',
      '',
      `The recorded events are in the artifacts of ${runLink(run)}${
        events.length > 0 ? `: ${events.join(', ')}` : ''
      }.`,
      '',
      '### History',
      '',
      HISTORY_OPEN,
      '| Date | Run | rrweb | Failing targets |',
      '| --- | --- | --- | --- |',
      ...rows,
      HISTORY_CLOSE,
      '',
    );
    return noMentions(lines.join('\n'));
  };

  let body = build(MESSAGE_LIMIT, history);
  if (body.length > MAX_BODY) body = build(SHORT_MESSAGE, history);
  let rows = history;
  while (body.length > MAX_BODY && rows.length > 1) {
    rows = rows.slice(0, -1);
    body = build(SHORT_MESSAGE, rows);
  }
  return capBody(body);
}

export const statusTitle = '[pre-release] Status of the latest run';

export const runBrokenTitle = (failures: Failure[]): string =>
  `[pre-release] Run broken: ${failures.length} checks failed`;

/** The single run-broken issue: what failed, without per-check issues. */
export function runBrokenBody(
  failures: Failure[],
  s: RunSummary,
  run: RunMeta,
): string {
  return capBody(
    noMentions(
      [
        RUN_BROKEN_MARKER,
        '',
        runCountLine({ failing: s.failures.length, heldBack: 0 }),
        '',
        `${failures.length} of the ${
          s.totalKeys
        } checks that ran failed in ${runLink(
          run,
        )}, with rrweb at commit ${code(run.rrwebCommit)}.`,
        'That usually means a broken build, a BrowserStack outage or a sweeping engine change, so no per-check issue was opened or changed.',
        '',
        '| Check | Failing targets | First message |',
        '| --- | --- | --- |',
        ...failures.map(
          (f) =>
            `| ${code(f.key)} | ${f.targets
              .map((t) => cell(t.targetId))
              .join(', ')} | ${untrusted(f.targets[0]?.message ?? '', 200)} |`,
        ),
        '',
      ].join('\n'),
    ),
  );
}

const issueRef = (n: number | undefined) => (n ? `#${n}` : 'new issue');

const bullets = (items: string[]) =>
  items.length > 0 ? items.map((i) => `- ${i}`) : ['None.'];

/**
 * The pinned status issue: the run, every target's counts, then one section
 * per thing a maintainer may need to act on. `issueLinks` maps a failing key
 * to its issue number, including issues this run just opened.
 */
export function statusBody(
  s: RunSummary,
  plan: IssuePlan,
  run: RunMeta,
  results: TargetResult[],
  issueLinks: Record<string, number>,
  opts: {
    browserstackMissing?: boolean;
    /** Targets a hand-started run chose not to run; `browserstack` stands for all of them. */
    leftOut?: string[];
    /** The per-run issue cap, when one is set. */
    issueCap?: number;
  } = {},
): string {
  const complete =
    s.missingTargets.length === 0 &&
    s.incompleteTargets.length === 0 &&
    !opts.browserstackMissing;
  const leftOut = (opts.leftOut ?? []).map((t) =>
    t === 'browserstack' ? 'BrowserStack' : cell(t),
  );
  const state =
    leftOut.length === 0
      ? `**${complete ? 'complete' : 'incomplete'}**`
      : complete
      ? 'a **partial run**'
      : 'an **incomplete partial run**';

  const failing = new Map<string, Set<string>>();
  for (const f of [...s.failures, ...s.parked.map((p) => p.failure)]) {
    for (const t of f.targets) {
      const set = failing.get(t.targetId) ?? new Set<string>();
      set.add(f.checkId);
      failing.set(t.targetId, set);
    }
  }
  const sorted = [...results].sort((a, b) =>
    a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0,
  );
  const targetRows = sorted.map((r) => {
    const fails = failing.get(r.targetId) ?? new Set<string>();
    const outcomes = Object.entries(r.checks);
    const count = (status: string) =>
      outcomes.filter(([id, c]) => c.status === status && !fails.has(id))
        .length;
    const name = r.incomplete
      ? `${cell(r.targetId)} (incomplete: ${untrusted(
          r.incompleteReason ?? 'unknown reason',
          SHORT_MESSAGE,
        )})`
      : cell(r.targetId);
    const version = r.browser
      ? `${r.browser.browserName} ${r.browser.browserVersion} (${
          r.browser.device ?? r.browser.platform
        })`
      : '–';
    return `| ${name} | ${
      version === '–' ? version : untrusted(version, SHORT_MESSAGE)
    } | ${r.launch.ok ? 'ok' : 'failed'} | ${count('pass')} | ${
      fails.size
    } | ${count('flaky')} | ${count('skipped')} | ${count('not-run')} |`;
  });

  const open: string[] = [];
  const recovered: string[] = [];
  let broken: string[] = [];
  for (const a of plan.actions) {
    if (a.type === 'create' || a.type === 'update' || a.type === 'reopen') {
      // No "opened" or "reopened" note: a re-run of the report then
      // leaves this body as it was.
      const n =
        issueLinks[a.failure.key] ??
        (a.type === 'create' ? undefined : a.issue);
      open.push(
        `${issueRef(n)} ${code(a.failure.key)} on ${a.failure.targets
          .map((t) => cell(t.targetId))
          .join(', ')}`,
      );
    } else if (a.type === 'close' || a.type === 'mark-recovered') {
      recovered.push(`#${a.issue} ${code(a.key)}`);
    } else if (a.type === 'run-broken') {
      broken = [
        `${a.failures.length} of the ${
          s.totalKeys
        } checks that ran failed, so no per-check issue was opened or changed. See ${issueRef(
          a.issue ?? issueLinks['run-broken'],
        )}.`,
        '',
      ];
    }
  }

  const missing = [
    ...s.missingTargets.map((t) => `${cell(t)}: no results`),
    ...(opts.browserstackMissing ? ['BrowserStack: no results'] : []),
  ];
  const incompleteReasons = sorted
    .filter((r) => r.incomplete)
    .map(
      (r) =>
        `${cell(r.targetId)}: ${untrusted(
          r.incompleteReason ?? 'unknown reason',
          SHORT_MESSAGE,
          false,
        )}`,
    );

  const lines = [
    STATUS_MARKER,
    '',
    runCountLine({
      failing: s.failures.length,
      heldBack: plan.heldBack.length,
      cap: opts.issueCap,
    }),
    '',
    `## Latest run: ${run.date}`,
    '',
    `[The run of ${run.date}](${run.runUrl}), with rrweb at commit ${code(
      run.rrwebCommit,
    )}, is ${state}.`,
    '',
    'This issue is rewritten after every scheduled run. An old date means a run did not happen.',
    '',
    '### Targets',
    '',
    '| Target | Version | Launch | Pass | Fail | Flaky | Skipped | Not run |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...targetRows,
    '',
    ...(broken.length > 0 ? ['### Run broken', '', ...broken] : []),
    '### Open failures',
    '',
    ...bullets(open),
    '',
    ...(plan.heldBack.length > 0
      ? [
          `### Held back by the per-run issue cap${
            opts.issueCap === undefined ? '' : ` (${opts.issueCap})`
          }`,
          '',
          ...bullets(
            plan.heldBack.map(
              (h) =>
                `${code(h.key)} on ${h.engines.join(', ')}, ${plural(
                  h.targets.length,
                  'target',
                  'targets',
                )}`,
            ),
          ),
          '',
        ]
      : []),
    '### Closed after recovering',
    '',
    ...bullets(recovered),
    '',
    '### Closed but still failing',
    '',
    ...bullets(plan.closedButFailing.map((c) => `#${c.issue} ${code(c.key)}`)),
    '',
    '### Parked',
    '',
    ...bullets(
      s.parked.map(
        (p) =>
          `${code(p.failure.key)} on ${p.failure.targets
            .map((t) => cell(t.targetId))
            .join(', ')}, parked until ${cell(p.entry.expires)}: [upstream](${
            p.entry.upstream
          })`,
      ),
    ),
    '',
    '### Flaky',
    '',
    ...bullets(s.flaky.map((f) => `${code(f.key)} on ${cell(f.targetId)}`)),
    '',
    '### Launch failures',
    '',
    ...bullets(
      s.launchFailures.map(
        (l) =>
          `${cell(l.targetId)}: ${untrusted(l.error, SHORT_MESSAGE, false)}`,
      ),
    ),
    '',
    '### Missing',
    '',
    ...bullets(missing),
    '',
    '### Incomplete',
    '',
    ...bullets(incompleteReasons),
    '',
    ...(leftOut.length > 0
      ? ['### Not covered by this run', '', ...bullets(leftOut), '']
      : []),
    ...(s.notes.length > 0
      ? [
          '### Notes',
          '',
          ...s.notes.map((n) => `- ${untrusted(n, SHORT_MESSAGE, false)}`),
          '',
        ]
      : []),
  ];
  return capBody(noMentions(lines.join('\n')));
}
