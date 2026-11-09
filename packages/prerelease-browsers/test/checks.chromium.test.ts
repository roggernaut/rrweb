import { runAttempt, runScenario } from '../src/node/run-check.ts';
import { buildPageBundle, readRrwebUmd } from '../src/node/page-source.ts';
import { chromium } from 'playwright';
import {
  launchPlaywright,
  playwrightDriver,
} from '../src/node/drivers/playwright.ts';
import type { PageDriver } from '../src/node/drivers/types.ts';
import { startFixtureServer } from '../src/node/fixture-server.ts';
import type { FixtureServer } from '../src/node/fixture-server.ts';
import { checks } from '../src/page/registry.ts';
import type { CheckMeta } from '../src/types.ts';

/** Every check that must exist; later tasks extend this list. */
const expectedIds = [
  // CSS
  'css-shorthand-roundtrip',
  'css-selector-colon-escape',
  'css-early-linked-stylesheet',
  'css-grid-template-areas',
  'css-adopted-stylesheets',
  'css-insert-rule',
  'css-nested-rules',
  // Built-in APIs
  'patched-mutation-observer',
  'tainted-input-getters',
  'missing-webgl-types',
  'missing-css-grouping-rule',
  // DOM
  'snapshot-basic',
  'shadow-dom-open',
  'custom-elements',
  'iframe-same-origin',
  'iframe-cross-origin',
  'dialog-top-layer',
  'node-order-burst',
  // Inputs
  'input-types',
  'checkbox-radio',
  'select',
  'contenteditable',
  'selection',
  // Canvas and media
  'canvas-2d',
  'canvas-webgl',
  'canvas-sampled',
  'media-play-pause',
  // Privacy
  'privacy-mask-all-inputs',
  'privacy-mask-text-class',
  'privacy-mask-text-selector',
  'privacy-block-class',
  'privacy-block-selector',
  'privacy-password-default',
  'privacy-mask-input-options',
  'privacy-mutation-after-snapshot',
  'privacy-attribute-mutation',
  'privacy-autofill',
  'privacy-shadow-dom',
  'privacy-adopted-stylesheet-shadow',
  'privacy-input-types',
  'privacy-canvas-block',
];

/**
 * Checks rrweb main fails today, each with the message it gives with masking
 * on. When rrweb is fixed, the test fails: drop the entry.
 */
const knownGaps: Record<string, string> = {
  // rrweb main records property sets such as fillStyle on a blocked 2d
  // canvas: the setter hook in observers/canvas/2d.ts skips the isBlocked
  // test that methods get.
  'privacy-canvas-block': 'privacy leak: blocked canvas recorded',
  // hookSetter drops the value getter where defineProperty does not merge
  // descriptors: rrweb-io/rrweb#1950.
  'tainted-input-getters': 'Input events recorded [null], expected "typed"',
};

/** Every performance scenario, run once each at a small scale. */
const perfIds = [
  'perf-large-stylesheet',
  'perf-snapshot-5k',
  'perf-snapshot-20k',
  'perf-snapshot-50k',
  'perf-mutation-burst-10k',
  'perf-sampled-canvases',
  'perf-record-stop-cycles',
];

/**
 * The only checks that may skip, each with its one allowed reason: an engine
 * without WebGL, or one that refuses to play audio.
 */
const allowedSkips: Record<string, string> = {
  'canvas-webgl': 'no webgl',
  'media-play-pause': 'play rejected',
};

/**
 * css-early-linked-stylesheet with rrweb's stylesheet inlining off, served
 * with the flag that registers test-only checks.
 */
const notInlined: CheckMeta = {
  id: 'test-early-stylesheet-not-inlined',
  kind: 'functional',
  tier: 'full',
  needsHttp: true,
  head: '<script>window.__prerelease_test=true</script>',
};

const timeoutMs = 60_000;
let driver: PageDriver;
let bundle: string;
let rrweb: string;
let server: FixtureServer;

beforeAll(async () => {
  bundle = await buildPageBundle();
  rrweb = readRrwebUmd();
  // Free ports, so parallel test files never collide on 8123.
  process.env.PRERELEASE_HTTP_PORT ??= '0';
  server = await startFixtureServer(
    { bundle, rrweb },
    { extraChecks: [notInlined] },
  );
  driver = await launchPlaywright({ engine: 'chromium' });
}, 60_000);

afterAll(async () => {
  await driver?.close();
  await server?.close();
});

test('chromium reports precise heap sizes and exposes gc', async () => {
  await driver.loadHtml('<!doctype html><body></body>');
  const grew = await driver.evaluate<number>(`(() => {
    const before = performance.memory.usedJSHeapSize;
    window.__keep = new Array(1e6).fill(1);
    return performance.memory.usedJSHeapSize - before;
  })()`);
  expect(grew).toBeGreaterThan(1e6);
  expect(await driver.evaluate('typeof gc')).toBe('function');
});

test('every expected check is registered', () => {
  const registered = checks.map((check) => check.id);
  for (const id of [...expectedIds, ...perfIds]) {
    expect(registered).toContain(id);
  }
});

describe.each(expectedIds)('%s', (id) => {
  const meta = () => checks.find((check) => check.id === id);

  const gap = knownGaps[id];
  test(
    gap === undefined ? 'passes on chromium' : 'fails on chromium as known',
    { timeout: timeoutMs + 10_000 },
    async () => {
      const check = meta();
      expect(check, `check ${id} is not registered`).toBeDefined();
      const result = await runAttempt(
        driver,
        check!,
        { bundle, rrweb, httpOrigin: server.origin },
        { timeoutMs },
      );
      if (gap !== undefined) {
        expect(result.message).toBe(gap);
        expect(result.ok).toBe(false);
        return;
      }
      if (result.skipped !== undefined) {
        expect(result.skipped, `unexpected skip in ${id}`).toBe(
          allowedSkips[id],
        );
        return;
      }
      expect(result.message ?? '').toBe('');
      expect(result.ok).toBe(true);
    },
  );
});

test(
  'css-early-linked-stylesheet fails when rrweb does not inline the stylesheet',
  { timeout: timeoutMs + 10_000 },
  async () => {
    const result = await runAttempt(
      driver,
      notInlined,
      { bundle, rrweb, httpOrigin: server.origin },
      { timeoutMs },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      'stylesheet text not captured in the recording',
    );
  },
);

describe.each(perfIds)('%s', (id) => {
  test(
    'gives one finite sample on chromium',
    { timeout: timeoutMs + 10_000 },
    async () => {
      const meta = checks.find((check) => check.id === id);
      expect(meta, `scenario ${id} is not registered`).toBeDefined();
      expect(meta!.kind).toBe('performance');
      const outcome = await runScenario(
        driver,
        meta!,
        { bundle, rrweb, httpOrigin: server.origin },
        { samples: 1, timeoutMs, scale: 0.02 },
      );
      expect(outcome.message ?? '').toBe('');
      expect(outcome.status).toBe('pass');
      expect(outcome.samples).toHaveLength(1);
      const [sample] = outcome.samples!;
      expect(Number.isFinite(sample.durationMs)).toBe(true);
      expect(sample.durationMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(sample.maxBlockMs)).toBe(true);
      expect(sample.maxBlockMs).toBeGreaterThanOrEqual(0);
      if (meta!.compare?.includes('heapDeltaBytes')) {
        // Chromium exposes performance.memory, so the delta must be there.
        expect(Number.isFinite(sample.heapDeltaBytes)).toBe(true);
      }
    },
  );
});

describe('perf-record-stop-cycles measurement', () => {
  const meta = () => checks.find((c) => c.id === 'perf-record-stop-cycles')!;

  test(
    'blocks for one cycle at a time, not the whole loop',
    { timeout: timeoutMs + 10_000 },
    async () => {
      const outcome = await runScenario(
        driver,
        meta(),
        { bundle, rrweb },
        { samples: 1, timeoutMs },
      );
      expect(outcome.status).toBe('pass');
      const [sample] = outcome.samples!;
      expect(sample.maxBlockMs).toBeLessThan(sample.durationMs / 2);
    },
  );

  test(
    'reports no heap delta from a Chromium launched without the heap flags',
    { timeout: timeoutMs + 10_000 },
    async () => {
      const browser = await chromium.launch();
      const plain = playwrightDriver(
        await (await browser.newContext()).newPage(),
        { canReachLocalhost: true, close: () => browser.close() },
      );
      try {
        await plain.loadHtml('<!doctype html><body></body>');
        // performance.memory is there, only rounded, and gc() is missing.
        expect(
          await plain.evaluate('typeof performance.memory.usedJSHeapSize'),
        ).toBe('number');
        expect(await plain.evaluate('typeof gc')).toBe('undefined');
        const outcome = await runScenario(
          plain,
          meta(),
          { bundle, rrweb },
          { samples: 1, timeoutMs, scale: 0.02 },
        );
        expect(outcome.status).toBe('pass');
        expect(outcome.samples![0]).not.toHaveProperty('heapDeltaBytes');
      } finally {
        await plain.close();
      }
    },
  );
});
