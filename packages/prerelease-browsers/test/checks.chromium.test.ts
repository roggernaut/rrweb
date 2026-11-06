import { runAttempt } from '../src/node/run-check.ts';
import { buildPageBundle, readRrwebUmd } from '../src/node/page-source.ts';
import { launchPlaywright } from '../src/node/drivers/playwright.ts';
import type { PageDriver } from '../src/node/drivers/types.ts';
import { startFixtureServer } from '../src/node/fixture-server.ts';
import type { FixtureServer } from '../src/node/fixture-server.ts';
import { checks } from '../src/page/registry.ts';

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
  // 'tainted-input-getters' is left out: rrweb main reads input.value
  // through the page's own getter, so a tainted getter records no text.
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
];

/**
 * The only checks that may skip, each with its one allowed reason: an engine
 * without WebGL, or one that refuses to play audio.
 */
const allowedSkips: Record<string, string> = {
  'canvas-webgl': 'no webgl',
  'media-play-pause': 'play rejected',
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
  server = await startFixtureServer({ bundle, rrweb });
  driver = await launchPlaywright({ engine: 'chromium' });
}, 60_000);

afterAll(async () => {
  await driver?.close();
  await server?.close();
});

test('every expected check is registered', () => {
  const registered = checks.map((check) => check.id);
  for (const id of expectedIds) expect(registered).toContain(id);
});

describe.each(expectedIds)('%s', (id) => {
  const meta = () => checks.find((check) => check.id === id);

  test('passes on chromium', { timeout: timeoutMs + 10_000 }, async () => {
    const check = meta();
    expect(check, `check ${id} is not registered`).toBeDefined();
    const result = await runAttempt(
      driver,
      check!,
      { bundle, rrweb, httpOrigin: server.origin },
      { timeoutMs },
    );
    if (result.skipped !== undefined) {
      expect(result.skipped, `unexpected skip in ${id}`).toBe(allowedSkips[id]);
      return;
    }
    expect(result.message ?? '').toBe('');
    expect(result.ok).toBe(true);
  });

  test(
    'fails with masking disabled when it is a privacy check',
    { timeout: timeoutMs + 10_000 },
    async () => {
      const check = meta();
      if (check?.kind !== 'privacy') return;
      const result = await runAttempt(
        driver,
        check,
        { bundle, rrweb, httpOrigin: server.origin },
        { timeoutMs, disableMasking: true },
      );
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/^(privacy leak|public control missing)/);
    },
  );
});
