import { readFileSync } from 'node:fs';
import {
  majorOf,
  newerMacOS,
  pickSameModelPair,
  resolveBrowserStackTargets,
  type CatalogueEntry,
} from '../src/node/browserstack.ts';
import { githubTargets, localTargets } from '../src/node/targets.ts';

const cat: CatalogueEntry[] = JSON.parse(
  readFileSync(
    new URL('./fixtures/browserstack-browsers.json', import.meta.url),
    'utf8',
  ),
);

function entry(over: Partial<CatalogueEntry>): CatalogueEntry {
  return {
    os: 'ios',
    os_version: '26',
    browser: 'iphone',
    device: null,
    browser_version: null,
    real_mobile: true,
    ...over,
  };
}
const dev = (device: string, os_version: string, os: string = 'ios') =>
  entry({ device, os_version, os });
const mac = (os_version: string) =>
  entry({
    os: 'OS X',
    os_version,
    browser: 'safari',
    browser_version: '1',
    real_mobile: null,
  });

describe('majorOf', () => {
  test('reads the leading number and the beta marker', () => {
    expect(majorOf('17')).toEqual({ major: 17, beta: false });
    expect(majorOf('14.0')).toEqual({ major: 14, beta: false });
    expect(majorOf('27 Beta')).toEqual({ major: 27, beta: true });
    expect(majorOf('17.0 beta')).toEqual({ major: 17, beta: true });
  });
  test('a name with no number is major 0, not NaN', () => {
    expect(majorOf('Sequoia')).toEqual({ major: 0, beta: false });
    expect(majorOf('Tahoe')).toEqual({ major: 0, beta: false });
  });
});

describe('pickSameModelPair', () => {
  test('iOS pair uses one plain iPhone model offering both versions', () => {
    const p = pickSameModelPair(cat, 'ios', /^iPhone \d+$/)!;
    expect(p.device).toMatch(/^iPhone \d+$/);
    expect(p.upcoming).not.toBe(p.stable);
    expect(
      cat.filter((e) => e.device === p.device).map((e) => e.os_version),
    ).toEqual(expect.arrayContaining([p.upcoming, p.stable]));
  });
  test('Android pair uses one plain Pixel model offering both versions', () => {
    const p = pickSameModelPair(cat, 'android', /^Google Pixel \d+$/)!;
    expect(p.device).toMatch(/^Google Pixel \d+$/);
    expect(majorOf(p.upcoming).major).toBeGreaterThan(majorOf(p.stable).major);
    expect(
      cat.filter((e) => e.device === p.device).map((e) => e.os_version),
    ).toEqual(expect.arrayContaining([p.upcoming, p.stable]));
  });
  test('a beta outranks the release of the same major', () => {
    const syn = [
      dev('iPhone 15', '26'),
      dev('iPhone 15', '27'),
      dev('iPhone 15', '27 Beta'),
    ];
    expect(pickSameModelPair(syn, 'ios', /^iPhone \d+$/)).toEqual({
      device: 'iPhone 15',
      upcoming: '27 Beta',
      stable: '27',
    });
  });
  test('no model has two versions: no pair', () => {
    expect(
      pickSameModelPair(
        [dev('iPhone 16', '26'), dev('iPhone 17', '27')],
        'ios',
        /./,
      ),
    ).toBeUndefined();
  });
  test('only devices that reach the newest top version qualify', () => {
    const syn = [
      dev('iPhone 13', '16'),
      dev('iPhone 13', '17'),
      dev('iPhone 15', '26'),
      dev('iPhone 15', '27'),
    ];
    expect(pickSameModelPair(syn, 'ios', /^iPhone \d+$/)?.device).toBe(
      'iPhone 15',
    );
  });
  test('prefers a matching name, otherwise the name that sorts last', () => {
    const two = (d: string) => [dev(d, '26'), dev(d, '27')];
    const syn = [...two('iPhone 15'), ...two('iPhone 16'), ...two('iPad Pro')];
    expect(pickSameModelPair(syn, 'ios', /^iPhone \d+$/)?.device).toBe(
      'iPhone 16',
    );
    expect(pickSameModelPair(syn, 'ios', /^Nothing$/)?.device).toBe(
      'iPhone 16',
    );
  });
  test('ignores other platforms and entries without a device', () => {
    const syn = [
      dev('Google Pixel 9', '16.0', 'android'),
      dev('Google Pixel 9', '17.0', 'android'),
      mac('Tahoe'),
    ];
    expect(pickSameModelPair(syn, 'ios', /./)).toBeUndefined();
    expect(pickSameModelPair(syn, 'android', /./)).toEqual({
      device: 'Google Pixel 9',
      upcoming: '17.0',
      stable: '16.0',
    });
  });
  test('the same version listed under several browsers counts once', () => {
    const syn = [
      entry({ device: 'iPhone 15', os_version: '27', browser: 'chromium' }),
      entry({ device: 'iPhone 15', os_version: '27', browser: 'iphone' }),
    ];
    expect(pickSameModelPair(syn, 'ios', /./)).toBeUndefined();
  });
});

describe('newerMacOS', () => {
  test('Safari on BrowserStack only when newer than the runner', () => {
    expect(newerMacOS([mac('Sequoia'), mac('Tahoe')], 'Tahoe')).toBeUndefined();
    expect(newerMacOS([mac('Tahoe'), mac('Zion')], 'Tahoe')).toBe('Zion');
  });
  test('picks the newest of several newer versions', () => {
    expect(
      newerMacOS([mac('Monterey'), mac('Sonoma'), mac('Sequoia')], 'Ventura'),
    ).toBe('Sequoia');
  });
  test('ignores entries that are not macOS', () => {
    expect(newerMacOS([dev('iPhone 15', 'Zion')], 'Tahoe')).toBeUndefined();
  });
});

describe('resolveBrowserStackTargets', () => {
  test('lists the rows in order, each with its pair group', () => {
    const specs = resolveBrowserStackTargets(cat);
    const rows = specs.map((t) => [t.id, t.pairGroup]);
    expect(rows.slice(0, 6)).toEqual([
      ['bs-chrome-beta', 'bs-chrome-win11'],
      ['bs-chrome-stable', 'bs-chrome-win11'],
      ['bs-edge-beta', 'bs-edge-win11'],
      ['bs-edge-stable', 'bs-edge-win11'],
      ['bs-firefox-beta', 'bs-firefox-win11'],
      ['bs-firefox-stable', 'bs-firefox-win11'],
    ]);
    expect(rows.slice(6).map(([id]) => id)).toEqual(
      expect.arrayContaining([
        'bs-ios-upcoming',
        'bs-ios-stable',
        'bs-android-upcoming',
        'bs-android-stable',
        'bs-android-lowend',
        'bs-samsung-internet',
      ]),
    );
    const un = (id: string) => specs.find((t) => t.id === id)!.pairGroup;
    expect(un('bs-ios-upcoming')).toBe('bs-ios');
    expect(un('bs-android-stable')).toBe('bs-android');
    expect(un('bs-android-lowend')).toBeUndefined();
    expect(un('bs-samsung-internet')).toBeUndefined();
  });
  test('desktop rows carry the exact capabilities', () => {
    const by = (id: string) =>
      resolveBrowserStackTargets(cat).find((t) => t.id === id)!;
    expect(by('bs-chrome-beta')).toMatchObject({
      engine: 'chromium',
      channel: 'upcoming',
      route: 'playwright-desktop',
      checks: 'focused',
      perf: 'compare',
      caps: {
        os: 'Windows',
        os_version: '11',
        browser: 'chrome',
        browser_version: 'latest-beta',
      },
    });
    expect(by('bs-edge-stable').caps).toEqual({
      os: 'Windows',
      os_version: '11',
      browser: 'edge',
      browser_version: 'latest',
    });
    expect(by('bs-firefox-beta')).toMatchObject({
      engine: 'gecko',
      route: 'selenium',
      caps: {
        browserName: 'firefox',
        browserVersion: 'latest-beta',
        'bstack:options': { os: 'Windows', osVersion: '11' },
      },
    });
  });
  test('mobile rows share one device per pair and are real devices', () => {
    const specs = resolveBrowserStackTargets(cat);
    for (const [os, browser, route] of [
      ['ios', 'safari', 'playwright-ios'],
      ['android', 'chrome', 'playwright-android'],
    ] as const) {
      const up = specs.find((t) => t.id === `bs-${os}-upcoming`)!;
      const st = specs.find((t) => t.id === `bs-${os}-stable`)!;
      expect(up.route).toBe(route);
      expect(up.caps.deviceName).toBe(st.caps.deviceName);
      expect(up.caps.osVersion).not.toBe(st.caps.osVersion);
      expect(up.caps).toMatchObject({ browser, realMobile: 'true' });
      expect(
        cat.some(
          (e) =>
            e.device === up.caps.deviceName &&
            e.os_version === up.caps.osVersion,
        ),
      ).toBe(true);
    }
  });
  test('ceiling-only rows: newer Safari, low-end Android, Samsung Internet', () => {
    const specs = resolveBrowserStackTargets(cat);
    const safari = specs.find((t) => t.id === 'bs-safari-newer')!;
    expect(safari).toMatchObject({
      engine: 'webkit',
      route: 'selenium',
      perf: 'ceiling-only',
    });
    expect(safari.pairGroup).toBeUndefined();
    const low = specs.find((t) => t.id === 'bs-android-lowend')!;
    expect(low.perf).toBe('ceiling-only');
    expect(low.caps.deviceName).toBe('Samsung Galaxy M32');
    const sam = specs.find((t) => t.id === 'bs-samsung-internet')!;
    expect(sam).toMatchObject({ route: 'selenium', perf: 'ceiling-only' });
    expect(sam.caps.browserName).toBe('samsung');
    expect(JSON.stringify(sam.caps)).toMatch(/Galaxy S\d/);
  });
  test('Samsung Internet takes the newest Galaxy S whatever the row order', () => {
    const galaxy = (device: string, os_version: string) =>
      entry({ os: 'android', browser: 'samsung', device, os_version });
    const rows = [
      galaxy('Samsung Galaxy S23 Ultra', '13.0'),
      galaxy('Samsung Galaxy S26', '16.0'),
      galaxy('Samsung Galaxy S24', '14.0'),
      galaxy('Samsung Galaxy S24', '16.0'),
      galaxy('Samsung Galaxy S26 Ultra', '16.0'),
      galaxy('Samsung Galaxy Tab S12 Plus', '17.0'),
      entry({
        os: 'android',
        browser: 'android',
        device: 'Samsung Galaxy S27',
        os_version: '17.0',
      }),
    ];
    for (const order of [rows, [...rows].reverse()]) {
      const sam = resolveBrowserStackTargets(order).find(
        (t) => t.id === 'bs-samsung-internet',
      )!;
      expect(sam.caps['bstack:options']).toEqual({
        deviceName: 'Samsung Galaxy S26 Ultra',
        osVersion: '16.0',
        realMobile: 'true',
      });
    }
  });
  test('rows whose device is missing are left out', () => {
    const ids = resolveBrowserStackTargets([]).map((t) => t.id);
    expect(ids).toEqual([
      'bs-chrome-beta',
      'bs-chrome-stable',
      'bs-edge-beta',
      'bs-edge-stable',
      'bs-firefox-beta',
      'bs-firefox-stable',
    ]);
  });
  test('the low-end Android falls back down the list and takes its newest version', () => {
    const syn = [
      dev('Samsung Galaxy A12', '10.0', 'android'),
      dev('Samsung Galaxy A12', '11.0', 'android'),
    ];
    const low = resolveBrowserStackTargets(syn).find(
      (t) => t.id === 'bs-android-lowend',
    )!;
    expect(low.caps).toMatchObject({
      deviceName: 'Samsung Galaxy A12',
      osVersion: '11.0',
    });
  });
  test('resolved ids are unique, disjoint from GitHub ids, and every pair group has one stable', () => {
    const specs = resolveBrowserStackTargets(cat);
    const ids = [
      ...specs.map((t) => t.id),
      ...githubTargets.map((t) => t.id),
      ...localTargets.map((t) => t.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of new Set(
      specs.flatMap((t) => (t.pairGroup ? [t.pairGroup] : [])),
    ))
      expect(
        specs.filter((t) => t.pairGroup === g && t.channel === 'stable'),
      ).toHaveLength(1);
  });
});
