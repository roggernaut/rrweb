import { setTimeout as timersSleep } from 'node:timers/promises';
import type { BrowserContext, Page } from 'playwright';
import { _android, chromium, webkit } from 'playwright';
import type { Engine } from '../types.ts';
import { playwrightDriver } from './drivers/playwright.ts';
import { connectSelenium } from './drivers/selenium.ts';
import type { BrowserInfo, PageDriver } from './drivers/types.ts';
import { DeadlineReached, errorMessage } from './run-check.ts';
import type { TargetDefinition } from './targets.ts';

/** One row of BrowserStack's Automate `browsers.json`, as the live API returns it. */
export interface CatalogueEntry {
  os: string;
  os_version: string;
  browser: string;
  device: string | null;
  browser_version: string | null;
  real_mobile: boolean | null;
}

export interface BrowserStackSpec {
  id: string;
  engine: Engine;
  channel: 'upcoming' | 'stable';
  pairGroup?: string;
  checks: 'focused';
  perf: 'compare' | 'ceiling-only';
  /** Longest-block ceiling for this target, when the 1000 ms default is too tight. */
  ceilingMs?: number;
  route:
    | 'playwright-desktop'
    | 'playwright-ios'
    | 'playwright-android'
    | 'selenium';
  caps: Record<string, unknown>;
}

/** Every id `resolveBrowserStackTargets` can return, in its order. */
export const browserStackIds = [
  'bs-chrome-beta',
  'bs-chrome-stable',
  'bs-edge-beta',
  'bs-edge-stable',
  'bs-firefox-beta',
  'bs-firefox-stable',
  'bs-safari-newer',
  'bs-ios-upcoming',
  'bs-ios-stable',
  'bs-android-upcoming',
  'bs-android-stable',
  'bs-android-lowend',
  'bs-samsung-internet',
] as const;

/**
 * Reads the leading number of a mobile os_version ('17', '14.0', '27 Beta').
 * A name with no number, such as a macOS name, is major 0: macOS versions are
 * ordered by `newerMacOS`, not by number.
 */
export function majorOf(osVersion: string): { major: number; beta: boolean } {
  const major = /^\d+/.exec(osVersion.trim());
  return {
    major: major ? Number(major[0]) : 0,
    beta: /beta/i.test(osVersion),
  };
}

/** Orders os_versions: by major, a beta above the release of the same major. */
function compareVersions(a: string, b: string): number {
  const x = majorOf(a);
  const y = majorOf(b);
  return (
    x.major - y.major ||
    Number(x.beta) - Number(y.beta) ||
    a.localeCompare(b, undefined, { numeric: true })
  );
}

function versionsByDevice(
  entries: CatalogueEntry[],
  os: string,
): Map<string, string[]> {
  const byDevice = new Map<string, Set<string>>();
  for (const e of entries) {
    if (e.os !== os || !e.device) continue;
    let versions = byDevice.get(e.device);
    if (!versions) byDevice.set(e.device, (versions = new Set()));
    versions.add(e.os_version);
  }
  return new Map(
    [...byDevice].map(([device, versions]) => [
      device,
      [...versions].sort(compareVersions),
    ]),
  );
}

/**
 * Picks one device model that offers both the newest OS and the one before
 * it, so performance compares the same hardware. A device qualifies when it
 * has at least two versions and its top version is the newest across all
 * devices. `prefer` wins over other names; ties go to the name that sorts last.
 */
export function pickSameModelPair(
  entries: CatalogueEntry[],
  os: 'ios' | 'android',
  prefer: RegExp,
): { device: string; upcoming: string; stable: string } | undefined {
  const devices = [...versionsByDevice(entries, os)].map(
    ([device, versions]) => ({ device, versions }),
  );
  const tops = devices.map((d) => d.versions[d.versions.length - 1]);
  const newest = tops.reduce<string | undefined>(
    (best, v) =>
      best === undefined || compareVersions(v, best) > 0 ? v : best,
    undefined,
  );
  const candidates = devices.filter(
    (d) =>
      d.versions.length >= 2 && d.versions[d.versions.length - 1] === newest,
  );
  const preferred = candidates.filter((d) => prefer.test(d.device));
  const pool = preferred.length > 0 ? preferred : candidates;
  pool.sort((a, b) =>
    a.device.localeCompare(b.device, undefined, { numeric: true }),
  );
  const best = pool[pool.length - 1];
  if (!best) return undefined;
  const { versions } = best;
  return {
    device: best.device,
    upcoming: versions[versions.length - 1],
    stable: versions[versions.length - 2],
  };
}

const macOSOrder = ['Monterey', 'Ventura', 'Sonoma', 'Sequoia', 'Tahoe'];

/**
 * The newest macOS the catalogue offers that sorts after the runner's, or
 * undefined. A name missing from the known order counts as newer than all
 * known ones, so a release BrowserStack adds before this list does still shows.
 */
export function newerMacOS(
  entries: CatalogueEntry[],
  runnerMacOS: string,
): string | undefined {
  const rank = (name: string) => {
    const i = macOSOrder.indexOf(name);
    return i === -1 ? macOSOrder.length : i;
  };
  let newest: string | undefined;
  for (const e of entries) {
    if (e.os !== 'OS X' || e.os_version === runnerMacOS) continue;
    if (rank(e.os_version) < rank(runnerMacOS)) continue;
    if (newest === undefined || rank(e.os_version) >= rank(newest)) {
      newest = e.os_version;
    }
  }
  return newest;
}

function newestVersion(
  entries: CatalogueEntry[],
  os: string,
  device: string,
): string | undefined {
  return versionsByDevice(entries, os).get(device)?.at(-1);
}

/** A named device, at its newest version. */
function namedDevice(
  entries: CatalogueEntry[],
  os: string,
  name: string,
): { device: string; osVersion: string } | undefined {
  const osVersion = newestVersion(entries, os, name);
  return osVersion ? { device: name, osVersion } : undefined;
}

/**
 * Among the matching devices, the one whose newest version is highest, with
 * ties going to the name that sorts last (so "S26 Ultra" beats "S26"). It does
 * not depend on the order of the rows.
 */
function newestDevice(
  entries: CatalogueEntry[],
  os: string,
  match: (device: string) => boolean,
): { device: string; osVersion: string } | undefined {
  let best: { device: string; osVersion: string } | undefined;
  for (const [device, versions] of versionsByDevice(entries, os)) {
    if (!match(device)) continue;
    const osVersion = versions[versions.length - 1];
    const cmp = best
      ? compareVersions(osVersion, best.osVersion) ||
        device.localeCompare(best.device, undefined, { numeric: true })
      : 1;
    if (cmp > 0) best = { device, osVersion };
  }
  return best;
}

const lowEndAndroid = [
  'Samsung Galaxy M32',
  'Motorola Moto G71 5G',
  'Samsung Galaxy A12',
];

function desktopSpecs(
  name: 'chrome' | 'edge',
  engine: Engine,
): BrowserStackSpec[] {
  return (['beta', 'stable'] as const).map((kind) => ({
    id: `bs-${name}-${kind}`,
    engine,
    channel: kind === 'beta' ? 'upcoming' : 'stable',
    pairGroup: `bs-${name}-win11`,
    checks: 'focused',
    perf: 'compare',
    route: 'playwright-desktop',
    caps: {
      os: 'Windows',
      os_version: '11',
      browser: name,
      browser_version: kind === 'beta' ? 'latest-beta' : 'latest',
    },
  }));
}

function mobileSpecs(
  os: 'ios' | 'android',
  pair: { device: string; upcoming: string; stable: string } | undefined,
): BrowserStackSpec[] {
  if (!pair) return [];
  return (['upcoming', 'stable'] as const).map((channel) => ({
    id: `bs-${os}-${channel}`,
    engine: os === 'ios' ? 'webkit' : 'chromium',
    channel,
    pairGroup: `bs-${os}`,
    checks: 'focused',
    perf: 'compare',
    route: os === 'ios' ? 'playwright-ios' : 'playwright-android',
    caps: {
      deviceName: pair.device,
      osVersion: pair[channel],
      browser: os === 'ios' ? 'safari' : 'chrome',
      realMobile: 'true',
    },
  }));
}

/**
 * Turns the live catalogue into the BrowserStack targets of one run. A row
 * whose device or OS is not in the catalogue is left out; the CLI reports
 * which ids are missing.
 */
export function resolveBrowserStackTargets(
  entries: CatalogueEntry[],
  runnerMacOS = 'Tahoe',
): BrowserStackSpec[] {
  const specs: BrowserStackSpec[] = [
    ...desktopSpecs('chrome', 'chromium'),
    ...desktopSpecs('edge', 'chromium'),
    ...(['beta', 'stable'] as const).map(
      (kind): BrowserStackSpec => ({
        id: `bs-firefox-${kind}`,
        engine: 'gecko',
        channel: kind === 'beta' ? 'upcoming' : 'stable',
        pairGroup: 'bs-firefox-win11',
        checks: 'focused',
        perf: 'compare',
        route: 'selenium',
        caps: {
          browserName: 'firefox',
          browserVersion: kind === 'beta' ? 'latest-beta' : 'latest',
          'bstack:options': { os: 'Windows', osVersion: '11' },
        },
      }),
    ),
  ];

  const macOS = newerMacOS(entries, runnerMacOS);
  if (macOS) {
    specs.push({
      id: 'bs-safari-newer',
      engine: 'webkit',
      channel: 'upcoming',
      checks: 'focused',
      perf: 'ceiling-only',
      route: 'selenium',
      caps: {
        browserName: 'safari',
        'bstack:options': { os: 'OS X', osVersion: macOS },
      },
    });
  }

  specs.push(
    ...mobileSpecs('ios', pickSameModelPair(entries, 'ios', /^iPhone \d+$/)),
    ...mobileSpecs(
      'android',
      pickSameModelPair(entries, 'android', /^Google Pixel \d+$/),
    ),
  );

  const lowEnd = lowEndAndroid
    .map((name) => namedDevice(entries, 'android', name))
    .find((found) => found !== undefined);
  if (lowEnd) {
    specs.push({
      id: 'bs-android-lowend',
      engine: 'chromium',
      channel: 'stable',
      checks: 'focused',
      perf: 'ceiling-only',
      // 3 s: the first real run measured a 1054 ms longest block for the 20k-node
      // snapshot on a Samsung Galaxy M32; every other BrowserStack target stayed
      // at or under 352 ms.
      ceilingMs: 3000,
      route: 'playwright-android',
      caps: {
        deviceName: lowEnd.device,
        osVersion: lowEnd.osVersion,
        browser: 'chrome',
        realMobile: 'true',
      },
    });
  }

  const galaxy = newestDevice(
    entries.filter((e) => e.browser === 'samsung'),
    'android',
    (d) => /^Samsung Galaxy S\d/.test(d),
  );
  if (galaxy) {
    specs.push({
      id: 'bs-samsung-internet',
      engine: 'chromium',
      channel: 'stable',
      checks: 'focused',
      perf: 'ceiling-only',
      route: 'selenium',
      caps: {
        browserName: 'samsung',
        'bstack:options': {
          deviceName: galaxy.device,
          osVersion: galaxy.osVersion,
          realMobile: 'true',
        },
      },
    });
  }
  return specs;
}

// Sessions

export interface Credentials {
  username: string;
  accessKey: string;
}

/** Reads the account from the environment, failing the launch without it. */
export function credentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Credentials {
  const username = env.BROWSERSTACK_USERNAME;
  const accessKey = env.BROWSERSTACK_ACCESS_KEY;
  if (!username || !accessKey) {
    throw new Error(
      'BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY must both be set',
    );
  }
  return { username, accessKey };
}

const catalogueUrl = 'https://api.browserstack.com/automate/browsers.json';

/** Fetches the live Automate catalogue. */
export async function fetchCatalogue(
  creds: Credentials,
): Promise<CatalogueEntry[]> {
  const auth = Buffer.from(`${creds.username}:${creds.accessKey}`).toString(
    'base64',
  );
  const res = await fetch(catalogueUrl, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    throw new Error(`${catalogueUrl} answered ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as CatalogueEntry[];
}

/**
 * Replaces the account name and key in `text`, as written and as they appear
 * inside a URL-encoded endpoint. Playwright puts the whole endpoint, caps
 * included, in its connect errors, and those end up in public issues.
 */
export function redactCredentials(text: string, creds: Credentials): string {
  let out = text;
  for (const secret of [creds.accessKey, creds.username]) {
    if (!secret) continue;
    const inJson = JSON.stringify(secret).slice(1, -1);
    for (const form of new Set([
      encodeURIComponent(inJson),
      encodeURIComponent(secret),
      inJson,
      secret,
    ])) {
      out = out.split(form).join('[redacted]');
    }
  }
  return out;
}

function redactedError(err: unknown, creds: Credentials): Error {
  return new Error(redactCredentials(errorMessage(err), creds));
}

/** The same driver, with credentials removed from every error it throws. */
function redacting(driver: PageDriver, creds: Credentials): PageDriver {
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (err) {
        throw redactedError(err, creds);
      }
    };
  return {
    canReachLocalhost: driver.canReachLocalhost,
    loadHtml: guard((html: string) => driver.loadHtml(html)),
    open: guard((url: string) => driver.open(url)),
    evaluate: <T>(expression: string) =>
      guard(() => driver.evaluate<T>(expression))(),
    describe: guard(() => driver.describe()),
    ...(driver.markSession && {
      markSession: guard(
        (passed: boolean, reason: string) =>
          driver.markSession?.(passed, reason) ?? Promise.resolve(),
      ),
    }),
    ...(driver.sessionUrl && {
      sessionUrl: guard(
        () => driver.sessionUrl?.() ?? Promise.resolve(undefined),
      ),
    }),
    close: guard(() => driver.close()),
  };
}

/**
 * The devices to list as no longer offered. Not bs-safari-newer: having no
 * newer macOS than the runner is the normal case, not a device that went away.
 */
export function unavailableDevices(
  ids: readonly string[],
  offered: Array<{ id: string }>,
  only?: string[],
): string[] {
  return ids.filter(
    (id) =>
      id !== 'bs-safari-newer' &&
      !offered.some((s) => s.id === id) &&
      (!only || only.includes(id)),
  );
}

const project = 'rrweb prerelease browsers';

/** The capabilities one session is opened with: the spec's, the run's and the account's. */
export function sessionCaps(
  spec: BrowserStackSpec,
  run: { build: string; playwrightVersion: string },
  creds: Credentials,
): Record<string, unknown> {
  if (spec.route === 'selenium') {
    const options = spec.caps['bstack:options'] as Record<string, unknown>;
    return {
      ...spec.caps,
      'bstack:options': {
        ...options,
        sessionName: spec.id,
        buildName: run.build,
        projectName: project,
        userName: creds.username,
        accessKey: creds.accessKey,
      },
    };
  }
  return {
    ...spec.caps,
    name: spec.id,
    build: run.build,
    project,
    'browserstack.username': creds.username,
    'browserstack.accessKey': creds.accessKey,
    'client.playwrightVersion': run.playwrightVersion,
  };
}

export function playwrightEndpoint(caps: Record<string, unknown>): string {
  return `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(
    JSON.stringify(caps),
  )}`;
}

const seleniumHub = 'https://hub-cloud.browserstack.com/wd/hub';

/** Long enough for BrowserStack to find a free device. */
const connectTimeoutMs = 10 * 60_000;

/**
 * The Playwright connect timeout: the usual one, cut to the time left before
 * the deadline (at least 1 ms, as 0 would mean no timeout). `capped` says the
 * deadline set it, so a timeout then means the deadline came.
 */
export function connectTimeoutFor(
  deadline: Date | undefined,
  now = Date.now(),
): { timeoutMs: number; capped: boolean } {
  const left = deadline === undefined ? Infinity : deadline.getTime() - now;
  return left < connectTimeoutMs
    ? { timeoutMs: Math.max(1, left), capped: true }
    : { timeoutMs: connectTimeoutMs, capped: false };
}

/** BrowserStack caps the reason it stores with a session status. */
const maxReasonLength = 255;

function executorCommand(action: string, args?: unknown): string {
  return `browserstack_executor: ${JSON.stringify({
    action,
    ...(args === undefined ? {} : { arguments: args }),
  })}`;
}

/**
 * The link without its query. BrowserStack's public_url carries an auth_token
 * that lets anyone view the session, and results files land in public
 * artifacts.
 */
function withoutQuery(url: string): string | undefined {
  try {
    const { origin, pathname } = new URL(url);
    return origin + pathname;
  } catch {
    return undefined;
  }
}

/** Session status and link, through BrowserStack's in-page executor commands. */
export function executorSession(
  run: (command: string) => Promise<unknown>,
): Pick<PageDriver, 'markSession' | 'sessionUrl'> {
  return {
    async markSession(passed, reason) {
      await run(
        executorCommand('setSessionStatus', {
          status: passed ? 'passed' : 'failed',
          reason: reason.slice(0, maxReasonLength),
        }),
      );
    },
    async sessionUrl() {
      const raw = await run(executorCommand('getSessionDetails'));
      const details = (typeof raw === 'string' ? JSON.parse(raw) : raw) as
        | { public_url?: unknown }
        | null
        | undefined;
      return typeof details?.public_url === 'string'
        ? withoutQuery(details.public_url)
        : undefined;
    },
  };
}

/** Runs executor commands in whichever page the context has open. */
function contextExecutor(context: BrowserContext) {
  return executorSession((command) => {
    const page = context.pages().at(-1);
    if (!page) throw new Error('no page open to run a BrowserStack command');
    return page.evaluate((_: string) => undefined, command);
  });
}

async function onlyPage(context: BrowserContext): Promise<Page> {
  return context.pages()[0] ?? (await context.newPage());
}

async function userAgentOf(context: BrowserContext): Promise<string> {
  const page = context.pages().at(-1);
  return page ? page.evaluate(() => navigator.userAgent) : '';
}

/** A mobile session's browser, read from its user agent, and its device. */
function mobileDescribe(
  context: BrowserContext,
  spec: BrowserStackSpec,
  browserName: string,
  version: RegExp,
): () => Promise<Partial<BrowserInfo>> {
  const os = spec.route === 'playwright-ios' ? 'iOS' : 'Android';
  return async () => ({
    browserName,
    browserVersion: version.exec(await userAgentOf(context))?.[1] ?? 'unknown',
    device: `${String(spec.caps.deviceName)} (${os} ${String(
      spec.caps.osVersion,
    )})`,
  });
}

/**
 * Sends every result across as a JSON string. BrowserStack's iOS bridge is
 * not Playwright's own server: it returns an object with a numeric `length`
 * as an array of that many nulls, so poll()'s `{ state: 'done', length }`
 * arrives as nulls and the check never finishes. Strings cross intact.
 * `undefined` arrives as null.
 */
export function jsonTransport(driver: PageDriver): PageDriver {
  return {
    ...driver,
    async evaluate<T>(expression: string): Promise<T> {
      const text = await driver.evaluate<unknown>(
        `JSON.stringify([(${expression})])`,
      );
      if (typeof text !== 'string') {
        throw new Error(
          `expected a JSON string from the page, got ${typeof text}`,
        );
      }
      return (JSON.parse(text) as [T])[0];
    },
  };
}

async function closeOnError<T>(
  work: () => Promise<T>,
  close: () => Promise<unknown>,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    await close().catch(() => undefined);
    throw err;
  }
}

async function connectSpec(
  spec: BrowserStackSpec,
  caps: Record<string, unknown>,
  timeoutMs: number,
): Promise<PageDriver> {
  const endpoint = playwrightEndpoint(caps);
  switch (spec.route) {
    case 'selenium':
      return connectSelenium({
        serverUrl: seleniumHub,
        capabilities: caps,
        canReachLocalhost: false,
        session: (wd) =>
          executorSession((command) => wd.executeScript(command)),
      });
    case 'playwright-desktop': {
      const browser = await chromium.connect(endpoint, {
        timeout: timeoutMs,
      });
      return closeOnError(
        async () => {
          const context = await browser.newContext();
          const page = await context.newPage();
          return {
            ...playwrightDriver(page, {
              canReachLocalhost: false,
              describe: () =>
                Promise.resolve({ browserName: String(spec.caps.browser) }),
              close: () => browser.close(),
            }),
            ...contextExecutor(context),
          };
        },
        () => browser.close(),
      );
    }
    case 'playwright-ios': {
      const browser = await webkit.connect(endpoint, {
        timeout: timeoutMs,
      });
      return closeOnError(
        async () => {
          // One context and one tab is all BrowserStack iOS allows.
          const context = browser.contexts()[0] ?? (await browser.newContext());
          return {
            ...jsonTransport(
              playwrightDriver(await onlyPage(context), {
                canReachLocalhost: false,
                describe: mobileDescribe(
                  context,
                  spec,
                  'safari',
                  /Version\/([\d.]+)/,
                ),
                close: () => browser.close(),
                singleTab: true,
              }),
            ),
            ...contextExecutor(context),
          };
        },
        () => browser.close(),
      );
    }
    case 'playwright-android': {
      const device = await _android.connect(endpoint, {
        timeout: timeoutMs,
      });
      return closeOnError(
        async () => {
          // A Chrome left running from setup would not take the new session.
          await device
            .shell('am force-stop com.android.chrome')
            .catch(() => undefined);
          const context = await device.launchBrowser();
          return {
            ...playwrightDriver(await onlyPage(context), {
              canReachLocalhost: false,
              describe: mobileDescribe(
                context,
                spec,
                'chrome',
                /Chrome\/([\d.]+)/,
              ),
              close: async () => {
                await context.close().catch(() => undefined);
                await device.close();
              },
            }),
            ...contextExecutor(context),
          };
        },
        () => device.close(),
      );
    }
  }
}

/**
 * The target for one resolved spec. Its connect reads the credentials from
 * the environment, so they never sit on the target itself, and strips them
 * from every error the session throws. With `run.deadline`, a Playwright
 * connect waits no longer than the time left, and running out is a
 * DeadlineReached. Pages load with setContent and a null origin there:
 * BrowserStack can't reach this machine, so needsHttp checks skip.
 */
export function toTarget(
  spec: BrowserStackSpec,
  run: { build: string; playwrightVersion: string; deadline?: Date },
): TargetDefinition {
  return {
    id: spec.id,
    engine: spec.engine,
    channel: spec.channel,
    ...(spec.pairGroup === undefined ? {} : { pairGroup: spec.pairGroup }),
    where: 'browserstack',
    checks: spec.checks,
    perf: spec.perf,
    ...(spec.ceilingMs === undefined ? {} : { ceilingMs: spec.ceilingMs }),
    perfSamples: 3,
    // An iPhone takes about 5 s an attempt and once stalled for 31 s.
    timeScale: 3,
    async connect() {
      const creds = credentialsFromEnv();
      const { timeoutMs, capped } = connectTimeoutFor(run.deadline);
      try {
        return redacting(
          await connectSpec(spec, sessionCaps(spec, run, creds), timeoutMs),
          creds,
        );
      } catch (err) {
        const message = redactCredentials(errorMessage(err), creds);
        if (capped && run.deadline && Date.now() >= run.deadline.getTime()) {
          throw new DeadlineReached(
            `deadline reached while connecting: ${message}`,
          );
        }
        throw new Error(message);
      }
    },
  };
}

// Pool and backoff

const parallelLimit =
  /BROWSERSTACK_ALL_PARALLELS_IN_USE|BROWSERSTACK_QUEUE_SIZE_EXCEEDED|parallel limit/i;

/** True for BrowserStack's "every session slot is busy" errors, which mean wait. */
export function isParallelLimitError(err: unknown): boolean {
  return parallelLimit.test(
    err instanceof Error ? err.message : String(err ?? ''),
  );
}

/**
 * Connects, waiting `waitMs` and trying again while BrowserStack reports its
 * parallel limit. Any other error throws as it is. When the next wait would
 * pass the deadline it throws DeadlineReached, carrying the last error.
 */
export async function connectWithBackoff(
  connect: () => Promise<PageDriver>,
  deadline: Date,
  waitMs = 60_000,
  sleep: (ms: number) => Promise<unknown> = timersSleep,
): Promise<PageDriver> {
  for (;;) {
    try {
      return await connect();
    } catch (err) {
      if (!isParallelLimitError(err)) throw err;
      if (Date.now() + waitMs > deadline.getTime()) {
        throw new DeadlineReached(
          `deadline reached while waiting for a free BrowserStack session: ${errorMessage(
            err,
          )}`,
        );
      }
      await sleep(waitMs);
    }
  }
}

/**
 * Runs the jobs with at most `limit` in flight, starting each as a slot
 * frees, and returns their results in job order. A job that rejects rejects
 * the pool, so callers catch inside each job.
 */
export async function runPool<T>(
  jobs: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results = new Array<T>(jobs.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, worker),
  );
  return results;
}
