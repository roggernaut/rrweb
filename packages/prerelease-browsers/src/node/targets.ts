import type { Engine } from '../types.ts';
import { startDriverProcess } from './driver-process.ts';
import { launchPlaywright } from './drivers/playwright.ts';
import { connectSelenium } from './drivers/selenium.ts';
import type { PageDriver } from './drivers/types.ts';
import { defaultHttpPort } from './fixture-server.ts';

export interface TargetDefinition {
  id: string;
  engine: Engine;
  channel: 'upcoming' | 'stable';
  pairGroup?: string;
  where:
    | 'local'
    | 'github-linux'
    | 'github-macos'
    | 'github-android'
    | 'browserstack';
  checks: 'all' | 'focused' | 'functional-privacy';
  perf: 'compare' | 'ceiling-only' | 'none';
  perfSamples: number; // 5 on GitHub, 3 on BrowserStack
  timeScale: number; // multiplies every timeout: 1 GitHub, 5 BrowserStack
  ceilingMs?: number;
  connect(): Promise<PageDriver>;
}

function localTarget(id: string, engine: Engine): TargetDefinition {
  return {
    id,
    engine,
    channel: 'stable',
    where: 'local',
    checks: 'all',
    perf: 'ceiling-only',
    perfSamples: 5,
    timeScale: 1,
    connect: () => launchPlaywright({ engine }),
  };
}

/** The bundled Playwright engines, for running a target on a developer machine. */
export const localTargets: TargetDefinition[] = [
  localTarget('local-chromium', 'chromium'),
  localTarget('local-firefox', 'gecko'),
  localTarget('local-webkit', 'webkit'),
];

/**
 * Moves the ports a run uses, so two Selenium targets in one job don't
 * collide: the driver port by `offset` and the fixture server's two ports
 * (PRERELEASE_HTTP_PORT and the next one up) by `2 * offset`. Port 0, free
 * ports, stays 0.
 */
export function applyPortOffset(
  offset: number,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`port offset must be a whole number >= 0: ${offset}`);
  }
  env.PRERELEASE_PORT_OFFSET = String(offset);
  const base = Number(env.PRERELEASE_HTTP_PORT ?? defaultHttpPort);
  env.PRERELEASE_HTTP_PORT = String(base === 0 ? 0 : base + 2 * offset);
}

function driverPort(base: number): number {
  return base + Number(process.env.PRERELEASE_PORT_OFFSET ?? 0);
}

/** Reads a value install.ts provides, failing the launch when it is missing. */
function installed(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set; run install.ts for this target first`);
  }
  return value;
}

type GithubTarget = Omit<TargetDefinition, 'perfSamples' | 'timeScale'>;

function onGithub(t: GithubTarget): TargetDefinition {
  return { ...t, perfSamples: 5, timeScale: 1 };
}

/** Starts a WebDriver server on `basePort` (plus the port offset) and opens a session on it. */
async function connectDriver(opts: {
  cmd: string;
  args: (port: number) => string[];
  basePort: number;
  capabilities: Record<string, unknown>;
}): Promise<PageDriver> {
  const port = driverPort(opts.basePort);
  const proc = await startDriverProcess(opts.cmd, opts.args(port), port);
  return connectSelenium({
    serverUrl: proc.url,
    capabilities: opts.capabilities,
    // Desktop drivers share the machine; on Android, the workflow maps the
    // fixture ports into the emulator with adb reverse.
    canReachLocalhost: true,
    onClose: () => proc.stop(),
  });
}

const geckodriverPort = 4444;

function desktopFirefox(): Promise<PageDriver> {
  return connectDriver({
    cmd: installed('GECKODRIVER'),
    args: (port) => ['--port', String(port)],
    basePort: geckodriverPort,
    capabilities: {
      browserName: 'firefox',
      'moz:firefoxOptions': {
        binary: installed('FIREFOX_BINARY'),
        args: ['-headless'],
      },
    },
  });
}

function safari(cmd: string, basePort: number, browserName: string) {
  return () =>
    connectDriver({
      cmd,
      args: (port) => ['-p', String(port)],
      basePort,
      capabilities: { browserName },
    });
}

const chromium = 'chromium' as const;

/** The targets the scheduled workflow runs on GitHub-hosted runners. */
export const githubTargets: TargetDefinition[] = [
  onGithub({
    id: 'chrome-canary',
    engine: chromium,
    channel: 'upcoming',
    pairGroup: 'chrome-linux',
    where: 'github-linux',
    checks: 'all',
    perf: 'compare',
    connect: () =>
      launchPlaywright({
        engine: chromium,
        executablePath: installed('CHROME_PATH'),
      }),
  }),
  onGithub({
    id: 'chrome-dev',
    engine: chromium,
    channel: 'upcoming',
    pairGroup: 'chrome-linux',
    where: 'github-linux',
    checks: 'all',
    perf: 'compare',
    connect: () =>
      launchPlaywright({
        engine: chromium,
        executablePath: installed('CHROME_PATH'),
      }),
  }),
  onGithub({
    id: 'chrome-stable',
    engine: chromium,
    channel: 'stable',
    pairGroup: 'chrome-linux',
    where: 'github-linux',
    checks: 'all',
    perf: 'compare',
    connect: () => launchPlaywright({ engine: chromium, channel: 'chrome' }),
  }),
  onGithub({
    id: 'edge-dev',
    engine: chromium,
    channel: 'upcoming',
    pairGroup: 'edge-linux',
    where: 'github-linux',
    checks: 'all',
    perf: 'compare',
    connect: () =>
      launchPlaywright({ engine: chromium, channel: 'msedge-dev' }),
  }),
  onGithub({
    id: 'edge-stable',
    engine: chromium,
    channel: 'stable',
    pairGroup: 'edge-linux',
    where: 'github-linux',
    checks: 'all',
    perf: 'compare',
    connect: () => launchPlaywright({ engine: chromium, channel: 'msedge' }),
  }),
  onGithub({
    id: 'firefox-nightly',
    engine: 'gecko',
    channel: 'upcoming',
    pairGroup: 'firefox-linux',
    where: 'github-linux',
    checks: 'all',
    perf: 'compare',
    connect: desktopFirefox,
  }),
  onGithub({
    id: 'firefox-stable',
    engine: 'gecko',
    channel: 'stable',
    pairGroup: 'firefox-linux',
    where: 'github-linux',
    checks: 'all',
    perf: 'compare',
    connect: desktopFirefox,
  }),
  onGithub({
    id: 'webkit-next',
    engine: 'webkit',
    channel: 'upcoming',
    where: 'github-linux',
    checks: 'all',
    perf: 'ceiling-only',
    connect: () =>
      launchPlaywright({
        engine: 'webkit',
        playwrightModule: installed('PLAYWRIGHT_NEXT'),
      }),
  }),
  onGithub({
    id: 'safari-tp',
    engine: 'webkit',
    channel: 'upcoming',
    pairGroup: 'safari-macos',
    where: 'github-macos',
    checks: 'all',
    perf: 'compare',
    connect: safari(
      '/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver',
      4445,
      'Safari Technology Preview',
    ),
  }),
  onGithub({
    id: 'safari-stable',
    engine: 'webkit',
    channel: 'stable',
    pairGroup: 'safari-macos',
    where: 'github-macos',
    checks: 'all',
    perf: 'compare',
    connect: safari('/usr/bin/safaridriver', 4446, 'safari'),
  }),
  onGithub({
    id: 'firefox-android-nightly',
    engine: 'gecko',
    channel: 'upcoming',
    where: 'github-android',
    checks: 'functional-privacy',
    perf: 'none',
    connect: () =>
      connectDriver({
        cmd: installed('GECKODRIVER'),
        // Without internal storage the session fails with "fchown failed".
        args: (port) => [
          '--port',
          String(port),
          '--android-storage',
          'internal',
        ],
        basePort: geckodriverPort,
        capabilities: {
          browserName: 'firefox',
          'moz:firefoxOptions': {
            androidPackage: 'org.mozilla.fenix',
            androidDeviceSerial: 'emulator-5554',
          },
        },
      }),
  }),
];

const targets: TargetDefinition[] = [...localTargets, ...githubTargets];

/**
 * One half of a pull request run: `t` with the pull request's rrweb (`pr`)
 * or the base branch's (`base`). The two halves share a pair group, and the
 * pull request half counts as upcoming, so `evaluatePerf` holds it against
 * the base half with the scheduled run's rules. Both run the focused checks.
 */
export function asPrRole(
  t: TargetDefinition,
  role: 'pr' | 'base',
): TargetDefinition {
  return {
    ...t,
    id: `${t.id}@${role}`,
    channel: role === 'pr' ? 'upcoming' : 'stable',
    pairGroup: `pr-${t.id}`,
    checks: 'focused',
    perf: 'compare',
  };
}

export function findTarget(id: string): TargetDefinition {
  const found = targets.find((t) => t.id === id);
  if (!found) {
    throw new Error(
      `unknown target "${id}"; known targets: ${targets
        .map((t) => t.id)
        .join(', ')}`,
    );
  }
  return found;
}
