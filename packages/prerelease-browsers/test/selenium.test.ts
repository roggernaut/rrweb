import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { startDriverProcess } from '../src/node/driver-process.ts';
import {
  connectSelenium,
  RealmReuseError,
} from '../src/node/drivers/selenium.ts';
import type { PageDriver } from '../src/node/drivers/types.ts';
import { buildPageBundle, readRrwebUmd } from '../src/node/page-source.ts';
import { runAttempt } from '../src/node/run-check.ts';
import { checks } from '../src/page/registry.ts';
import { overHttpTests } from './helpers/over-http.ts';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** A stand-in driver: serves a ready /status after a short delay. */
const fakeDriverScript = `
  const port = Number(process.argv[1]);
  setTimeout(() => {
    require('node:http')
      .createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ value: { ready: req.url === '/status' } }));
      })
      .listen(port, '127.0.0.1');
  }, 300);
`;

describe('startDriverProcess', () => {
  test('resolves once /status is ready and stop ends the process', async () => {
    const port = await freePort();
    const proc = await startDriverProcess(
      process.execPath,
      ['-e', fakeDriverScript, String(port)],
      port,
    );
    expect(proc.url).toBe(`http://127.0.0.1:${port}`);
    const status = await (await fetch(`${proc.url}/status`)).json();
    expect(status).toEqual({ value: { ready: true } });
    await proc.stop();
    await expect(fetch(`${proc.url}/status`)).rejects.toThrow();
  });

  test('rejects when the process exits while another server answers on its port', async () => {
    const leftover = createHttpServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ value: { ready: true } }));
    });
    await new Promise<void>((r) => leftover.listen(0, '127.0.0.1', r));
    const { port } = leftover.address() as AddressInfo;
    // Like a second geckodriver on a fixed port: binding fails, so it exits.
    const binds = `require('node:http').createServer().listen(${port}, '127.0.0.1')`;
    try {
      await expect(
        startDriverProcess(process.execPath, ['-e', binds], port),
      ).rejects.toThrow(/exited.*EADDRINUSE/s);
    } finally {
      await new Promise((r) => leftover.close(r));
    }
  });

  test('rejects when the process exits before it is ready', async () => {
    const port = await freePort();
    await expect(
      startDriverProcess(
        process.execPath,
        ['-e', 'console.error("no browser here"); process.exit(3)'],
        port,
      ),
    ).rejects.toThrow(/exited with code 3.*no browser here/s);
  });
});

/**
 * Just enough of a WebDriver server for connectSelenium: sessions,
 * navigation, windows and the scripts loadHtml runs. With `keepWindow`, the
 * reuse marker survives navigation within a window, like an engine that
 * reuses the Window; with `sharedRealm` too, it shows in a new tab as well.
 * With `noNewWindow`, the New Window command is unknown; with `failClose`,
 * Close Window errors; with `failReturnToNew`, switching back to a new tab
 * after the one switch New Window makes errors.
 */
async function startFakeWebDriver() {
  const state = {
    sessions: 0,
    navigations: [] as string[],
    keepWindow: false,
    sharedRealm: false,
    noNewWindow: false,
    failClose: false,
    failReturnToNew: false,
    switches: [] as string[],
    current: 'w1',
    /** Open windows, each with whether a page was written into it. */
    windows: new Map([['w1', false]]),
    opened: [] as string[],
    closed: [] as string[],
    writes: 0,
  };
  const server = createHttpServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const send = (value: unknown, status = 200) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ value }));
    };
    const route = `${req.method} ${req.url}`;
    if (route === 'POST /session') {
      state.sessions++;
      return send({ sessionId: 'fake', capabilities: { browserName: 'fake' } });
    }
    if (route === 'POST /session/fake/url') {
      state.navigations.push((JSON.parse(body) as { url: string }).url);
      return send(null);
    }
    if (route === 'GET /session/fake/window') return send(state.current);
    if (route === 'POST /session/fake/window/new' && !state.noNewWindow) {
      const handle = `w${state.windows.size + state.closed.length + 1}`;
      state.windows.set(handle, false);
      state.opened.push(handle);
      return send({ handle, type: 'tab' });
    }
    if (route === 'POST /session/fake/window') {
      const { handle } = JSON.parse(body) as { handle: string };
      const returning = state.switches.includes(handle);
      state.switches.push(handle);
      if (state.failReturnToNew && handle !== 'w1' && returning) {
        return send({ error: 'no such window', message: 'gone' }, 404);
      }
      state.current = handle;
      return send(null);
    }
    if (route === 'DELETE /session/fake/window' && state.failClose) {
      return send({ error: 'unknown error', message: 'cannot close' }, 500);
    }
    if (route === 'DELETE /session/fake/window') {
      state.windows.delete(state.current);
      state.closed.push(state.current);
      return send([...state.windows.keys()]);
    }
    if (route === 'POST /session/fake/execute/sync') {
      const { script } = JSON.parse(body) as { script: string };
      if (script.includes('document.readyState')) return send('complete');
      if (script.includes('document.write')) {
        state.windows.set(state.current, true);
        state.writes++;
        return send(null);
      }
      if (script.includes('=== true')) {
        const written = state.sharedRealm
          ? state.writes > 0
          : state.windows.get(state.current) === true;
        return send(state.keepWindow && written);
      }
      return send(null);
    }
    if (route === 'DELETE /session/fake') return send(null);
    send({ error: 'unknown command', message: route }, 404);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    state,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

describe('connectSelenium against a fake WebDriver server', () => {
  let fake: Awaited<ReturnType<typeof startFakeWebDriver>>;
  beforeEach(async () => {
    fake = await startFakeWebDriver();
  });
  afterEach(async () => {
    await fake.close();
  });

  const connect = () =>
    connectSelenium({
      serverUrl: fake.url,
      capabilities: { browserName: 'fake' },
      canReachLocalhost: false,
    });

  test('every load navigates to a blank URL no earlier load used', async () => {
    const driver = await connect();
    await driver.loadHtml('<p>one</p>');
    await driver.loadHtml('<p>two</p>');
    await driver.loadHtml('<p>three</p>');
    await driver.close();
    const { navigations } = fake.state;
    expect(navigations).toHaveLength(3);
    expect(new Set(navigations).size).toBe(3);
    for (const url of navigations) expect(url).toMatch(/^about:blank\?/);
  });

  test('a load that keeps the previous Window moves to a fresh tab and closes the old one', async () => {
    fake.state.keepWindow = true;
    const driver = await connect();
    await driver.loadHtml('<p>one</p>');
    await driver.loadHtml('<p>two</p>');
    await driver.close();
    expect(fake.state.opened).toEqual(['w2']);
    expect(fake.state.closed).toEqual(['w1']);
    expect(fake.state.current).toBe('w2');
    expect(fake.state.windows.get('w2')).toBe(true);
    // The second load navigated again, in the new tab, to a new blank URL.
    expect(fake.state.navigations).toHaveLength(3);
    expect(new Set(fake.state.navigations).size).toBe(3);
  });

  test('a load whose fresh tab keeps the old Window too throws RealmReuseError', async () => {
    fake.state.keepWindow = true;
    fake.state.sharedRealm = true;
    const driver = await connect();
    await driver.loadHtml('<p>one</p>');
    const load = driver.loadHtml('<p>two</p>');
    await expect(load).rejects.toBeInstanceOf(RealmReuseError);
    await expect(load).rejects.toThrow(
      /kept the previous Window, and so did a new tab/,
    );
    await driver.close();
  });

  test('a browser without New Window throws RealmReuseError', async () => {
    fake.state.keepWindow = true;
    fake.state.noNewWindow = true;
    const driver = await connect();
    await driver.loadHtml('<p>one</p>');
    const load = driver.loadHtml('<p>two</p>');
    await expect(load).rejects.toBeInstanceOf(RealmReuseError);
    await expect(load).rejects.toThrow(
      /could not move to a new tab \(new window\): /,
    );
    expect(fake.state.closed).toEqual([]);
    await driver.close();
  });

  test('a Close Window error while moving to a new tab throws RealmReuseError', async () => {
    fake.state.keepWindow = true;
    fake.state.failClose = true;
    const driver = await connect();
    await driver.loadHtml('<p>one</p>');
    const load = driver.loadHtml('<p>two</p>');
    await expect(load).rejects.toBeInstanceOf(RealmReuseError);
    await expect(load).rejects.toThrow(
      /could not move to a new tab \(close window\): cannot close/,
    );
    await driver.close();
  });

  test('a failed switch back to the new tab throws RealmReuseError', async () => {
    fake.state.keepWindow = true;
    fake.state.failReturnToNew = true;
    const driver = await connect();
    await driver.loadHtml('<p>one</p>');
    const load = driver.loadHtml('<p>two</p>');
    await expect(load).rejects.toBeInstanceOf(RealmReuseError);
    await expect(load).rejects.toThrow(
      /could not move to a new tab \(switch to new window\): gone/,
    );
    expect(fake.state.closed).toEqual(['w1']);
    await driver.close();
  });

  test('SELENIUM_REMOTE_URL and SELENIUM_BROWSER cannot redirect the session', async () => {
    const other = await startFakeWebDriver();
    const saved = {
      url: process.env.SELENIUM_REMOTE_URL,
      browser: process.env.SELENIUM_BROWSER,
    };
    process.env.SELENIUM_REMOTE_URL = other.url;
    process.env.SELENIUM_BROWSER = 'chrome';
    try {
      const driver = await connect();
      await driver.close();
      expect(fake.state.sessions).toBe(1);
      expect(other.state.sessions).toBe(0);
    } finally {
      for (const [key, value] of [
        ['SELENIUM_REMOTE_URL', saved.url],
        ['SELENIUM_BROWSER', saved.browser],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await other.close();
    }
  });
});

const geckodriver = process.env.GECKODRIVER;
const firefoxBinary = process.env.FIREFOX_BINARY;

describe.skipIf(!geckodriver || !firefoxBinary)('Selenium on Firefox', () => {
  const timeoutMs = 60_000;
  let driver: PageDriver;
  let bundle: string;
  let rrweb: string;

  beforeAll(async () => {
    bundle = await buildPageBundle();
    rrweb = readRrwebUmd();
    const port = await freePort();
    const proc = await startDriverProcess(
      geckodriver!,
      ['--port', String(port)],
      port,
    );
    driver = await connectSelenium({
      serverUrl: proc.url,
      capabilities: {
        browserName: 'firefox',
        'moz:firefoxOptions': { binary: firefoxBinary, args: ['-headless'] },
      },
      canReachLocalhost: true,
      onClose: proc.stop,
    });
  }, 60_000);

  afterAll(async () => {
    await driver?.close();
  });

  test('describes the browser from the session and the page', async () => {
    await driver.loadHtml('<!doctype html><body></body>');
    const info = await driver.describe();
    expect(info.browserName).toBe('firefox');
    expect(info.browserVersion).toMatch(/^\d+\./);
    const platforms: Record<string, string> = {
      darwin: 'mac',
      linux: 'linux',
      win32: 'windows',
    };
    expect(info.platform).toBe(platforms[process.platform]);
    expect(info.userAgent).toMatch(/Firefox\//);
  });

  test('every load gets a fresh Window', async () => {
    await driver.loadHtml(
      '<!doctype html><script>window.__realm_marker = 1</script>',
    );
    expect(await driver.evaluate('typeof window.__realm_marker')).toBe(
      'number',
    );
    await driver.loadHtml('<!doctype html><body></body>');
    expect(await driver.evaluate('typeof window.__realm_marker')).toBe(
      'undefined',
    );
  });

  test.each(['snapshot-basic', 'privacy-mask-all-inputs'])(
    '%s passes',
    { timeout: timeoutMs + 10_000 },
    async (id) => {
      const meta = checks.find((check) => check.id === id)!;
      const result = await runAttempt(
        driver,
        meta,
        { bundle, rrweb },
        { timeoutMs },
      );
      expect(result.message ?? '').toBe('');
      expect(result.ok).toBe(true);
    },
  );

  describe('a check loaded over http', () => {
    overHttpTests(() => driver, timeoutMs);
  });
});
