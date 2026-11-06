import type { Engine } from '../types.ts';

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
  route:
    | 'playwright-desktop'
    | 'playwright-ios'
    | 'playwright-android'
    | 'selenium';
  caps: Record<string, unknown>;
}

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
