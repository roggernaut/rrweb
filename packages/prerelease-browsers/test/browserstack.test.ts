import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import {
  browserStackIds,
  connectTimeoutFor,
  connectWithBackoff,
  executorSession,
  isParallelLimitError,
  jsonTransport,
  majorOf,
  newerMacOS,
  pickSameModelPair,
  playwrightEndpoint,
  redactCredentials,
  resolveBrowserStackTargets,
  runPool,
  sessionCaps,
  toTarget,
  type BrowserStackSpec,
  type CatalogueEntry,
} from '../src/node/browserstack.ts';
import { playwrightDriver } from '../src/node/drivers/playwright.ts';
import { DeadlineReached } from '../src/node/run-check.ts';
import type { PageDriver } from '../src/node/drivers/types.ts';
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
  test('browserStackIds lists every row the full catalogue resolves, in order', () => {
    expect(resolveBrowserStackTargets(cat).map((t) => t.id)).toEqual([
      ...browserStackIds,
    ]);
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

const tick = () => new Promise((r) => setTimeout(r, 0));
const noSleep = async () => undefined;
const future = new Date(Date.now() + 3_600_000);
const driverStub = { canReachLocalhost: false } as PageDriver;

describe('runPool', () => {
  test('pool never exceeds its limit and keeps order', async () => {
    let live = 0,
      peak = 0;
    const jobs = Array.from({ length: 12 }, (_, i) => async () => {
      live++;
      peak = Math.max(peak, live);
      await tick();
      live--;
      return i;
    });
    expect(await runPool(jobs, 5)).toEqual([...Array(12).keys()]);
    expect(peak).toBe(5);
  });
  test('fewer jobs than the limit, and no jobs', async () => {
    expect(await runPool([async () => 'a', async () => 'b'], 5)).toEqual([
      'a',
      'b',
    ]);
    expect(await runPool([], 5)).toEqual([]);
  });
});

describe('connectWithBackoff', () => {
  test('backoff retries parallel-limit errors and nothing else', async () => {
    let n = 0;
    const flaky = async () => {
      if (n++ < 2) throw new Error('BROWSERSTACK_ALL_PARALLELS_IN_USE');
      return driverStub;
    };
    expect(await connectWithBackoff(flaky, future, 1, noSleep)).toBe(
      driverStub,
    );
    await expect(
      connectWithBackoff(
        () => Promise.reject(new Error('bad caps')),
        future,
        1,
        noSleep,
      ),
    ).rejects.toThrow('bad caps');
  });
  test('backoff gives up at the deadline', async () => {
    await expect(
      connectWithBackoff(
        () => Promise.reject(new Error('parallel limit')),
        new Date(0),
        1,
        noSleep,
      ),
    ).rejects.toThrow('parallel limit');
  });
  test('giving up at the deadline is a DeadlineReached, other errors are not', async () => {
    const cutOff = await connectWithBackoff(
      () => Promise.reject(new Error('parallel limit')),
      new Date(Date.now() + 50),
      1_000,
      noSleep,
    ).catch((err: unknown) => err);
    expect(cutOff).toBeInstanceOf(DeadlineReached);
    const other = await connectWithBackoff(
      () => Promise.reject(new Error('bad caps')),
      new Date(0),
      1,
      noSleep,
    ).catch((err: unknown) => err);
    expect(other).not.toBeInstanceOf(DeadlineReached);
  });
  test('the connect timeout never runs past the deadline', () => {
    const now = Date.now();
    expect(connectTimeoutFor(new Date(now + 3_600_000), now)).toEqual({
      timeoutMs: 600_000,
      capped: false,
    });
    expect(connectTimeoutFor(new Date(now + 90_000), now)).toEqual({
      timeoutMs: 90_000,
      capped: true,
    });
    expect(connectTimeoutFor(new Date(now - 5), now).timeoutMs).toBe(1);
    expect(connectTimeoutFor(undefined, now)).toEqual({
      timeoutMs: 600_000,
      capped: false,
    });
  });
  test('waits waitMs between tries', async () => {
    const waits: number[] = [];
    let n = 0;
    await connectWithBackoff(
      async () => {
        if (n++ < 2) throw new Error('BROWSERSTACK_QUEUE_SIZE_EXCEEDED');
        return driverStub;
      },
      future,
      7,
      async (ms) => void waits.push(ms),
    );
    expect(waits).toEqual([7, 7]);
  });
  test('isParallelLimitError reads the message of any thrown value', () => {
    expect(isParallelLimitError(new Error('x Parallel Limit reached'))).toBe(
      true,
    );
    expect(isParallelLimitError('BROWSERSTACK_QUEUE_SIZE_EXCEEDED')).toBe(true);
    expect(isParallelLimitError(new Error('Could not start session'))).toBe(
      false,
    );
    expect(isParallelLimitError(undefined)).toBe(false);
  });
});

describe('sessions', () => {
  const run = {
    build: 'rrweb prerelease 2026-11-06 #42',
    playwrightVersion: '1.61.1',
  };
  const creds = { username: 'someone', accessKey: 'k3y/+?' };
  const spec = (id: string) =>
    resolveBrowserStackTargets(cat).find((t) => t.id === id)!;

  test('toTarget runs on BrowserStack with scaled timeouts and 3 samples', () => {
    const t = toTarget(spec('bs-ios-upcoming'), run);
    expect(t).toMatchObject({
      id: 'bs-ios-upcoming',
      engine: 'webkit',
      channel: 'upcoming',
      pairGroup: 'bs-ios',
      where: 'browserstack',
      checks: 'focused',
      perf: 'compare',
      timeScale: 5,
      perfSamples: 3,
    });
    expect(JSON.stringify(t)).not.toContain('accessKey');
  });
  test('toTarget fails the launch when credentials are missing', async () => {
    const saved = { ...process.env };
    delete process.env.BROWSERSTACK_USERNAME;
    delete process.env.BROWSERSTACK_ACCESS_KEY;
    try {
      await expect(
        toTarget(spec('bs-chrome-beta'), run).connect(),
      ).rejects.toThrow(/BROWSERSTACK_USERNAME/);
    } finally {
      Object.assign(process.env, saved);
    }
  });
  test('Playwright caps carry the run, the credentials and the client version', () => {
    expect(sessionCaps(spec('bs-chrome-beta'), run, creds)).toEqual({
      os: 'Windows',
      os_version: '11',
      browser: 'chrome',
      browser_version: 'latest-beta',
      name: 'bs-chrome-beta',
      build: 'rrweb prerelease 2026-11-06 #42',
      project: 'rrweb prerelease browsers',
      'browserstack.username': 'someone',
      'browserstack.accessKey': 'k3y/+?',
      'client.playwrightVersion': '1.61.1',
    });
  });
  test('Selenium caps put the run and the credentials in bstack:options', () => {
    expect(sessionCaps(spec('bs-firefox-beta'), run, creds)).toEqual({
      browserName: 'firefox',
      browserVersion: 'latest-beta',
      'bstack:options': {
        os: 'Windows',
        osVersion: '11',
        sessionName: 'bs-firefox-beta',
        buildName: 'rrweb prerelease 2026-11-06 #42',
        projectName: 'rrweb prerelease browsers',
        userName: 'someone',
        accessKey: 'k3y/+?',
      },
    });
  });
  test('sessionCaps leaves the spec untouched', () => {
    const s: BrowserStackSpec = spec('bs-firefox-stable');
    const before = JSON.stringify(s);
    sessionCaps(s, run, creds);
    expect(JSON.stringify(s)).toBe(before);
  });
  test('the Playwright endpoint encodes the caps as JSON', () => {
    const url = playwrightEndpoint({ a: 'b c', d: '&' });
    expect(url.startsWith('wss://cdp.browserstack.com/playwright?caps=')).toBe(
      true,
    );
    expect(
      JSON.parse(decodeURIComponent(url.slice(url.indexOf('=') + 1))),
    ).toEqual({ a: 'b c', d: '&' });
  });
  test('credentials are redacted from error text, raw and URL-encoded', () => {
    const text = `ws connecting ${playwrightEndpoint(
      sessionCaps(spec('bs-chrome-beta'), run, creds),
    )} as someone with k3y/+?`;
    const out = redactCredentials(text, creds);
    expect(out).not.toContain('someone');
    expect(out).not.toContain('k3y');
    expect(out).toContain('ws connecting wss://cdp.browserstack.com');
  });
});

describe('jsonTransport', () => {
  /** Evaluates like BrowserStack's iOS bridge: objects with a length come back as arrays of nulls. */
  const bridge = {
    ...driverStub,
    async evaluate<T>(expression: string): Promise<T> {
      const value = new Function(`return (${expression});`)() as unknown;
      if (value && typeof value === 'object' && 'length' in value) {
        return Array.from({ length: Number(value.length) }, () => null) as T;
      }
      return value as T;
    },
  } as PageDriver;
  test('the raw bridge mangles a poll result', async () => {
    expect(await bridge.evaluate('({ state: "done", length: 2 })')).toEqual([
      null,
      null,
    ]);
  });
  test('values cross the bridge intact as JSON', async () => {
    const driver = jsonTransport(bridge);
    expect(await driver.evaluate('({ state: "done", length: 2 })')).toEqual({
      state: 'done',
      length: 2,
    });
    expect(await driver.evaluate('"a\\ud83d\\ude00b"')).toBe('a\ud83d\ude00b');
    expect(await driver.evaluate('void 0')).toBeNull();
    expect(await driver.evaluate('1, 2')).toBe(2);
  });
});

describe('single-tab Playwright driver', () => {
  test('every load gets a fresh Window', async () => {
    const browser = await webkit.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      const driver = playwrightDriver(page, {
        canReachLocalhost: false,
        close: () => browser.close(),
        singleTab: true,
      });
      await driver.loadHtml('<p>one</p>');
      await driver.evaluate(
        '(window.leaked = 1, window.MutationObserver = function () {}, 0)',
      );
      await driver.loadHtml('<p>two</p>');
      expect(await driver.evaluate('typeof window.leaked')).toBe('undefined');
      expect(
        await driver.evaluate(
          'String(window.MutationObserver).includes("[native code]")',
        ),
      ).toBe(true);
      expect(await driver.evaluate('document.body.textContent')).toBe('two');
      expect(browser.contexts()[0].pages()).toHaveLength(1);
    } finally {
      await browser.close();
    }
  }, 60_000);
});

describe('run-browserstack command line', () => {
  const cli = fileURLToPath(new URL('../src/node/cli.ts', import.meta.url));
  const runCli = (...args: string[]) =>
    spawnSync(process.execPath, [cli, 'run-browserstack', ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BROWSERSTACK_USERNAME: '',
        BROWSERSTACK_ACCESS_KEY: '',
      },
    });

  test('passes --check through, checked before any session', () => {
    const known = runCli(
      '--only',
      'bs-chrome-beta',
      '--check',
      'css-nested-rules',
    );
    expect(known.status).toBe(1);
    expect(known.stderr).toContain('BROWSERSTACK_USERNAME');

    const unknown = runCli('--check', 'no-such-check');
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('unknown check "no-such-check"');
  }, 30_000);
});

describe('session link', () => {
  const details = (publicUrl: unknown) =>
    executorSession(async (command) => {
      expect(command).toContain('getSessionDetails');
      return JSON.stringify({ public_url: publicUrl });
    });

  test('is recorded without its share token', async () => {
    const url = await details(
      'https://automate.browserstack.com/builds/b1/sessions/s1?auth_token=secret123',
    ).sessionUrl!();
    expect(url).toBe('https://automate.browserstack.com/builds/b1/sessions/s1');
    expect(url).not.toContain('?');
    expect(url).not.toContain('secret123');
  });

  test('is left out when BrowserStack sends none, or nonsense', async () => {
    expect(await details(undefined).sessionUrl!()).toBeUndefined();
    expect(await details('not a url').sessionUrl!()).toBeUndefined();
  });
});
