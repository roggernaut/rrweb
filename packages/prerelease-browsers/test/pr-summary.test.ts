import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { TargetResult } from '../src/node/results.ts';
import { writeResult } from '../src/node/results.ts';
import { summarizePr } from '../src/report/pr-summary.ts';
import {
  failing,
  incomplete,
  launchFailed,
  passing,
  perf,
} from './helpers/results.ts';

const expected = ['chrome-stable@pr', 'chrome-stable@base'];
const pr = { channel: 'upcoming', pairGroup: 'pr-chrome-stable' } as const;
const base = { channel: 'stable', pairGroup: 'pr-chrome-stable' } as const;

test('a check failing only with the PR rrweb fails the run', () => {
  const v = summarizePr(
    [
      failing('chrome-stable@pr', 'css-nested-rules', pr),
      passing('chrome-stable@base', 'css-nested-rules', base),
    ],
    expected,
    [],
  );
  expect(v.failures).toEqual([
    expect.objectContaining({
      targetId: 'chrome-stable',
      key: 'css-nested-rules:functional',
      message: 'css-nested-rules broke',
      reproduce:
        'yarn workspace @rrweb/prerelease-browsers run-target --target chrome-stable --pr-role pr --check css-nested-rules',
    }),
  ]);
  expect(v.warnings).toEqual([]);
  expect(v.incomplete).toEqual([]);
  expect(v.markdown).toMatch(/^Fail: 1 failing/m);
});

test('a check failing with both builds is only a warning', () => {
  const v = summarizePr(
    [
      failing('chrome-stable@pr', 'css-nested-rules', pr),
      failing('chrome-stable@base', 'css-nested-rules', base),
    ],
    expected,
    [],
  );
  expect(v.failures).toEqual([]);
  expect(v.warnings).toHaveLength(1);
  expect(v.warnings[0].targetId).toBe('chrome-stable');
  expect(v.warnings[0].message).toMatch(/^also fails on base: /);
  expect(v.markdown).toMatch(/^Pass/m);
});

test('a check failing only with the base rrweb is a warning', () => {
  const v = summarizePr(
    [
      passing('chrome-stable@pr', 'css-nested-rules', pr),
      failing('chrome-stable@base', 'css-nested-rules', base),
    ],
    expected,
    [],
  );
  expect(v.failures).toEqual([]);
  expect(v.warnings).toEqual([
    expect.objectContaining({
      targetId: 'chrome-stable',
      key: 'css-nested-rules:functional',
      message: 'fails only on base: css-nested-rules broke',
    }),
  ]);
});

test('a failure on base for another target does not excuse this one', () => {
  const v = summarizePr(
    [
      failing('chrome-stable@pr', 'css-nested-rules', pr),
      passing('chrome-stable@base', 'css-nested-rules', base),
      failing('edge-stable@pr', 'css-nested-rules', {
        channel: 'upcoming',
        pairGroup: 'pr-edge-stable',
      }),
      failing('edge-stable@base', 'css-nested-rules', {
        channel: 'stable',
        pairGroup: 'pr-edge-stable',
      }),
    ],
    [...expected, 'edge-stable@pr', 'edge-stable@base'],
    [],
  );
  expect(v.failures.map((f) => f.targetId)).toEqual(['chrome-stable']);
  expect(v.warnings.map((f) => f.targetId)).toEqual(['edge-stable']);
});

test('PR rrweb 1.6x slower than base fails', () => {
  const v = summarizePr(
    [
      perf('chrome-stable@pr', 'upcoming', [160, 170, 165], pr),
      perf('chrome-stable@base', 'stable', [100, 105, 102], base),
    ],
    expected,
    [],
  );
  expect(v.failures[0].message).toMatch(/^durationMs 165 vs stable 102/);
  expect(v.failures[0].key).toBe('perf-snapshot-5k:performance');
});

/** Sets every sample's longest block on the result's one perf check. */
function blocking(r: TargetResult, maxBlockMs: number): TargetResult {
  for (const c of Object.values(r.checks)) {
    c.samples = c.samples?.map((x) => ({ ...x, maxBlockMs }));
  }
  return r;
}

test('a base ceiling breach does not excuse a PR slowdown', () => {
  const v = summarizePr(
    [
      blocking(perf('chrome-stable@pr', 'upcoming', [160, 170, 165], pr), 1200),
      blocking(
        perf('chrome-stable@base', 'stable', [100, 105, 102], base),
        1200,
      ),
    ],
    expected,
    [],
  );
  expect(v.failures).toEqual([
    expect.objectContaining({
      targetId: 'chrome-stable',
      key: 'perf-snapshot-5k:performance',
      message: 'durationMs 165 vs stable 102 (1.62x)',
    }),
  ]);
  expect(v.warnings).toEqual([
    expect.objectContaining({
      message: 'also fails on base: longest block 1200 ms over 1000 ms ceiling',
    }),
  ]);
});

test('a slowdown alone fails even when only base breaches the ceiling', () => {
  const v = summarizePr(
    [
      perf('chrome-stable@pr', 'upcoming', [160, 170, 165], pr),
      blocking(
        perf('chrome-stable@base', 'stable', [100, 105, 102], base),
        1200,
      ),
    ],
    expected,
    [],
  );
  expect(v.failures.map((f) => f.message)).toEqual([
    'durationMs 165 vs stable 102 (1.62x)',
  ]);
  expect(v.warnings.map((f) => f.message)).toEqual([
    'fails only on base: longest block 1200 ms over 1000 ms ceiling',
  ]);
  expect(v.markdown).toMatch(/^Fail: 1 failing/m);
});

test('a ceiling breach on both builds is only a warning', () => {
  const v = summarizePr(
    [
      blocking(perf('chrome-stable@pr', 'upcoming', [100, 105, 102], pr), 1200),
      blocking(
        perf('chrome-stable@base', 'stable', [100, 105, 102], base),
        1200,
      ),
    ],
    expected,
    [],
  );
  expect(v.failures).toEqual([]);
  expect(v.warnings.map((f) => f.message)).toEqual([
    'also fails on base: longest block 1200 ms over 1000 ms ceiling',
  ]);
});

test('notes, such as a skipped comparison, are shown as code', () => {
  const v = summarizePr(
    [
      perf('chrome-stable@pr', 'upcoming', [160, 170, 165], pr),
      passing('chrome-stable@base', 'css-nested-rules', base),
    ],
    expected,
    [],
  );
  expect(v.markdown).toContain('### Notes');
  expect(v.markdown).toContain(
    '- `perf-snapshot-5k: chrome-stable＠base has no samples, so chrome-stable＠pr was not compared`',
  );
  expect(v.markdown).not.toMatch(/@[a-z0-9]/i);
});

test('a comparison with no base samples makes the run incomplete', () => {
  const v = summarizePr(
    [
      perf('chrome-stable@pr', 'upcoming', [160, 170, 165], pr),
      passing('chrome-stable@base', 'css-nested-rules', base),
    ],
    expected,
    [],
  );
  expect(v.failures).toEqual([]);
  expect(v.incomplete).toEqual(['chrome-stable@pr']);
  expect(v.markdown).toMatch(/^Incomplete/m);
  expect(v.markdown).toContain(
    'no performance comparison for perf-snapshot-5k',
  );
});

test('a measured comparison within the limits still passes', () => {
  const v = summarizePr(
    [
      perf('chrome-stable@pr', 'upcoming', [100, 110, 105], pr),
      perf('chrome-stable@base', 'stable', [100, 110, 105], base),
    ],
    expected,
    [],
  );
  expect(v.incomplete).toEqual([]);
  expect(v.markdown).toMatch(/^Pass/m);
});

test('a missing base result makes the run incomplete', () => {
  const v = summarizePr(
    [passing('chrome-stable@pr', 'css-nested-rules', pr)],
    expected,
    [],
  );
  expect(v.incomplete).toEqual(['chrome-stable@base']);
  expect(v.markdown).toMatch(/^Incomplete/m);
});

test('a role stopped by the deadline makes the run incomplete', () => {
  const v = summarizePr(
    [
      passing('chrome-stable@pr', 'css-nested-rules', pr),
      incomplete('chrome-stable@base', base),
    ],
    expected,
    [],
  );
  expect(v.incomplete).toEqual(['chrome-stable@base']);
  expect(v.markdown).toMatch(/^Incomplete/m);
});

test('an incomplete reason is shown as code', () => {
  const v = summarizePr(
    [
      passing('chrome-stable@pr', 'css-nested-rules', pr),
      incomplete('chrome-stable@base', { ...base, reason: 'odd `x` @team' }),
    ],
    expected,
    [],
  );
  expect(v.markdown).toContain(
    "- chrome-stable@<!-- -->base: stopped early (`odd 'x' ＠team`)",
  );
});

test('a role stopped for want of a fresh window makes the run incomplete', () => {
  const v = summarizePr(
    [
      passing('chrome-stable@pr', 'css-nested-rules', pr),
      incomplete('chrome-stable@base', {
        ...base,
        reason: 'fresh window unavailable',
      }),
    ],
    expected,
    [],
  );
  expect(v.failures).toEqual([]);
  expect(v.incomplete).toEqual(['chrome-stable@base']);
  expect(v.markdown).toMatch(/^Incomplete/m);
  expect(v.markdown).toContain(
    '- chrome-stable@<!-- -->base: stopped early (`fresh window unavailable`)',
  );
});

test('a browser that fails to launch only with the base rrweb makes the run incomplete', () => {
  const v = summarizePr(
    [
      passing('chrome-stable@pr', 'css-nested-rules', pr),
      launchFailed('chrome-stable@base', 'no binary', base),
    ],
    expected,
    [],
  );
  expect(v.failures).toEqual([]);
  expect(v.incomplete).toEqual(['chrome-stable@base']);
  expect(v.warnings).toEqual([
    expect.objectContaining({
      targetId: 'chrome-stable',
      message: 'browser failed to launch: no binary',
    }),
  ]);
  expect(v.markdown).toMatch(/^Incomplete/m);
  expect(v.markdown).toContain('so nothing was compared');
});

test('a browser that fails to launch with the PR rrweb makes the run incomplete', () => {
  const v = summarizePr(
    [
      launchFailed('chrome-stable@pr', 'no binary', pr),
      failing('chrome-stable@base', 'css-nested-rules', base),
    ],
    expected,
    [],
  );
  expect(v.failures).toEqual([]);
  expect(v.incomplete).toEqual(['chrome-stable@pr']);
  // Base failures say nothing about a PR whose rrweb never ran.
  expect(v.warnings).toEqual([
    expect.objectContaining({
      targetId: 'chrome-stable',
      message: 'browser failed to launch: no binary',
    }),
  ]);
  expect(v.markdown).toMatch(/^Incomplete/m);
});

test('a browser that fails to launch for both roles makes the run incomplete', () => {
  const v = summarizePr(
    [
      launchFailed('chrome-stable@pr', 'no binary', pr),
      launchFailed('chrome-stable@base', 'no binary', base),
    ],
    expected,
    [],
  );
  expect(v.failures).toEqual([]);
  expect(v.warnings).toHaveLength(2);
  expect(v.incomplete).toEqual(['chrome-stable@pr', 'chrome-stable@base']);
  expect(v.markdown).toMatch(/^Incomplete/m);
});

test('a parked failure neither fails nor warns', () => {
  const v = summarizePr(
    [
      failing('chrome-stable@pr', 'css-nested-rules', pr),
      passing('chrome-stable@base', 'css-nested-rules', base),
    ],
    expected,
    [
      {
        key: 'css-nested-rules:functional',
        upstream: 'https://bugs.chromium.org/p/chromium/issues/detail?id=1',
        expires: '2099-01-01',
      },
    ],
  );
  expect(v.failures).toEqual([]);
  expect(v.warnings).toEqual([]);
  expect(v.markdown).toMatch(/^Pass/m);
});

test('a clean run passes', () => {
  const v = summarizePr(
    [
      passing('chrome-stable@pr', 'css-nested-rules', pr),
      passing('chrome-stable@base', 'css-nested-rules', base),
    ],
    expected,
    [],
  );
  expect(v).toEqual(
    expect.objectContaining({ failures: [], warnings: [], incomplete: [] }),
  );
  expect(v.markdown.split('\n')).toContain('Pass');
});

test('the summary mentions nobody and renders messages as code', () => {
  const r = failing('chrome-stable@pr', 'css-nested-rules', pr);
  r.checks['css-nested-rules'].message =
    'expected @octocat and @1team | [x](https://evil.invalid) `rm`';
  const v = summarizePr(
    [r, launchFailed('chrome-stable@base', 'ping @rrweb-io/core', base)],
    expected,
    [],
  );
  expect(v.markdown).not.toMatch(/@[a-z0-9]/i);
  expect(v.markdown).toContain(
    '`yarn --cwd packages/prerelease-browsers run-target --target chrome-stable --pr-role pr --check css-nested-rules`',
  );
  expect(v.markdown).toContain(
    "`expected ＠octocat and ＠1team \\| [x](https://evil.invalid) 'rm'`",
  );
});

test('a crash with the base rrweb makes the run incomplete', () => {
  const crashed = incomplete('chrome-stable@base', {
    ...base,
    reason: 'crashed',
  });
  const v = summarizePr(
    [passing('chrome-stable@pr', 'css-nested-rules', pr), crashed],
    expected,
    [],
  );
  expect(v.incomplete).toEqual(['chrome-stable@base']);
  expect(v.warnings).toEqual([]);
  expect(v.markdown).toMatch(/^Incomplete/m);
});

test('a crash with the pull request rrweb makes the run incomplete', () => {
  const crashed = incomplete('chrome-stable@pr', { ...pr, reason: 'crashed' });
  const v = summarizePr(
    [crashed, passing('chrome-stable@base', 'css-nested-rules', base)],
    expected,
    [],
  );
  expect(v.incomplete).toEqual(['chrome-stable@pr']);
});

describe('the command line', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'prerelease-pr-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const script = fileURLToPath(
    new URL('../src/report/pr-summary.ts', import.meta.url),
  );
  const run = (summaryFile?: string) =>
    promisify(execFile)(
      process.execPath,
      [
        script,
        '--results',
        join(tmp, 'results'),
        '--expected',
        expected.join(','),
      ],
      {
        env: {
          ...process.env,
          GITHUB_STEP_SUMMARY: summaryFile ?? '',
        },
      },
    ).then(
      ({ stdout }) => ({ code: 0, stdout }),
      (err: { code: number; stdout: string }) => ({
        code: err.code,
        stdout: err.stdout,
      }),
    );

  test('exits 0 and prints the summary for a passing run', async () => {
    await writeResult(
      join(tmp, 'results'),
      passing('chrome-stable@pr', 'css-nested-rules', pr),
    );
    await writeResult(
      join(tmp, 'results'),
      passing('chrome-stable@base', 'css-nested-rules', base),
    );
    const { code, stdout } = await run();
    expect(code).toBe(0);
    expect(stdout).toMatch(/^Pass$/m);
  });

  test('exits 1 and appends to the step summary for a failing run', async () => {
    await writeResult(
      join(tmp, 'results'),
      failing('chrome-stable@pr', 'css-nested-rules', pr),
    );
    await writeResult(
      join(tmp, 'results'),
      passing('chrome-stable@base', 'css-nested-rules', base),
    );
    const summaryFile = join(tmp, 'summary.md');
    const { code } = await run(summaryFile);
    expect(code).toBe(1);
    expect(await readFile(summaryFile, 'utf8')).toMatch(/^Fail: 1 failing/m);
  });

  test('exits 1 when a result is missing', async () => {
    await writeResult(
      join(tmp, 'results'),
      passing('chrome-stable@pr', 'css-nested-rules', pr),
    );
    const { code, stdout } = await run();
    expect(code).toBe(1);
    expect(stdout).toMatch(/^Incomplete/m);
  });
});
