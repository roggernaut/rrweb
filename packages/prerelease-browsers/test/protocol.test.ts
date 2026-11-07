import type { PageDriver } from '../src/node/drivers/types.ts';
import { launchPlaywright } from '../src/node/drivers/playwright.ts';
import {
  buildPageBundle,
  composePage,
  readRrwebUmd,
} from '../src/node/page-source.ts';
import { runAttempt } from '../src/node/run-check.ts';
import { driverProbe } from '../src/page/registry.ts';
import type { CheckMeta } from '../src/types.ts';
import { overHttpTests } from './helpers/over-http.ts';

const meta = (id: string): CheckMeta => ({
  id,
  kind: 'functional',
  tier: 'focused',
  head: '<script>window.__prerelease_test=true</script>',
});

let driver: PageDriver;
let src: { bundle: string; rrweb: string };

beforeAll(async () => {
  driver = await launchPlaywright({ engine: 'chromium' });
  src = { bundle: await buildPageBundle(), rrweb: readRrwebUmd() };
}, 60_000);

afterAll(async () => {
  await driver?.close();
});

test('snapshot-basic passes on chromium', async () => {
  const r = await runAttempt(driver, meta('snapshot-basic'), src, {
    timeoutMs: 30_000,
  });
  expect(r).toMatchObject({ ok: true });
  expect(r.events!.some((e: any) => e.type === 2)).toBe(true);
});

test('chunked read survives a surrogate pair on the boundary', async () => {
  const r = await runAttempt(driver, meta('test-surrogate-boundary'), src, {
    timeoutMs: 10_000,
  });
  expect(r.message!.endsWith('😀z')).toBe(true);
});

// WebDriver returns strings well-formed, replacing each lone surrogate with
// U+FFFD; Playwright does not, so the test above passes without the guard.
const loneSurrogate =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const webdriverStrings = (d: PageDriver): PageDriver => ({
  ...d,
  async evaluate<T>(expression: string) {
    const value = await d.evaluate<T>(expression);
    return (
      typeof value === 'string' ? value.replace(loneSurrogate, '\ufffd') : value
    ) as T;
  },
});

test('chunked read survives a surrogate boundary over WebDriver strings', async () => {
  const r = await runAttempt(
    webdriverStrings(driver),
    meta('test-surrogate-boundary'),
    src,
    { timeoutMs: 10_000 },
  );
  expect(r.message!.endsWith('😀z')).toBe(true);
  expect(r.message).not.toContain('\ufffd');
});

test('a thrown check reports an error, not a hang', async () => {
  const r = await runAttempt(driver, meta('test-throws'), src, {
    timeoutMs: 10_000,
  });
  expect(r).toMatchObject({
    ok: false,
    message: expect.stringContaining('boom'),
  });
});

test('a hung check times out', async () => {
  const r = await runAttempt(driver, meta('test-hangs'), src, {
    timeoutMs: 2_000,
  });
  expect(r.message).toBe('timed out after 2000 ms');
});

test('a page error before start fails the check', async () => {
  const r = await runAttempt(driver, meta('test-load-error'), src, {
    timeoutMs: 10_000,
  });
  expect(r).toMatchObject({
    ok: false,
    message: expect.stringContaining('page error: early boom'),
  });
});

test('start returns before any check code runs', async () => {
  const m = meta('test-start-deferred');
  await driver.loadHtml(composePage(m, src.bundle, src.rrweb));
  // One expression, so nothing else can run between start and the reads.
  const atReturn = await driver.evaluate(
    `(__prerelease.start(${JSON.stringify(m.id)}, {}),
      [window.__prerelease_test_ran === true, __prerelease.poll().state])`,
  );
  expect(atReturn).toEqual([false, 'running']);
  await vi.waitFor(async () => {
    expect(await driver.evaluate('__prerelease.poll().state')).toBe('done');
  });
  expect(await driver.evaluate('window.__prerelease_test_ran')).toBe(true);
});

test('replaying leaves the recorded events as they were', async () => {
  const r = await runAttempt(driver, meta('test-replay-keeps-events'), src, {
    timeoutMs: 10_000,
  });
  expect(r.message ?? '').toBe('');
  expect(r.ok).toBe(true);
});

describe('a check loaded over http', () => {
  overHttpTests(() => driver, 30_000);
});

describe('the driver probe', () => {
  const probe: CheckMeta = {
    id: driverProbe.id,
    kind: driverProbe.kind,
    tier: driverProbe.tier,
  };

  test('settles on a page that renders frames', async () => {
    expect(await runAttempt(driver, probe, src, { timeoutMs: 10_000 })).toEqual(
      { ok: true },
    );
  });

  // A screen that is off or locked, or a hidden window, renders no frames.
  // Every recording check then hangs in stop(), so the probe must too, or
  // a driver that cannot render would read as an rrweb hang.
  test('hangs on a page whose frames never fire, like a recording check', async () => {
    const noFrames = {
      ...probe,
      head: '<script>window.requestAnimationFrame = () => 0</script>',
    };
    expect(
      await runAttempt(driver, noFrames, src, { timeoutMs: 2_000 }),
    ).toEqual({ ok: false, message: 'timed out after 2000 ms' });
  });
});
