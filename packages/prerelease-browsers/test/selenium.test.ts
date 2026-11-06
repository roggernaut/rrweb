import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { startDriverProcess } from '../src/node/driver-process.ts';
import { connectSelenium } from '../src/node/drivers/selenium.ts';
import type { PageDriver } from '../src/node/drivers/types.ts';
import { buildPageBundle, readRrwebUmd } from '../src/node/page-source.ts';
import { runAttempt } from '../src/node/run-check.ts';
import { checks } from '../src/page/registry.ts';

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
    expect(info.platform).toBe('mac');
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
});
