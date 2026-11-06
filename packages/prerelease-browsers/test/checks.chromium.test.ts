import { runAttempt } from '../src/node/run-check.ts';
import { buildPageBundle, readRrwebUmd } from '../src/node/page-source.ts';
import { launchPlaywright } from '../src/node/drivers/playwright.ts';
import type { PageDriver } from '../src/node/drivers/types.ts';
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
];

const timeoutMs = 60_000;
let driver: PageDriver;
let bundle: string;
let rrweb: string;

beforeAll(async () => {
  bundle = await buildPageBundle();
  rrweb = readRrwebUmd();
  driver = await launchPlaywright({ engine: 'chromium' });
}, 60_000);

afterAll(async () => {
  await driver?.close();
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
      { bundle, rrweb },
      { timeoutMs },
    );
    if (result.skipped) {
      // Until the fixture server exists, only needsHttp checks may skip.
      expect(check!.needsHttp).toBe(true);
      expect(result.skipped).toBe('needs http');
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
        { bundle, rrweb },
        { timeoutMs, disableMasking: true },
      );
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/^(privacy leak|public control missing)/);
    },
  );
});
