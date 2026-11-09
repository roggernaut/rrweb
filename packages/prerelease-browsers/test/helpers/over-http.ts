import type { PageDriver } from '../../src/node/drivers/types.ts';
import type { FixtureServer } from '../../src/node/fixture-server.ts';
import { startFixtureServer } from '../../src/node/fixture-server.ts';
import { buildPageBundle, readRrwebUmd } from '../../src/node/page-source.ts';
import type { PageSource } from '../../src/node/run-check.ts';
import { runAttempt } from '../../src/node/run-check.ts';
import { checks } from '../../src/page/registry.ts';
import type { CheckMeta } from '../../src/types.ts';

/** A check registered only under test, which its head switches on. */
const testCheck = (id: string, extra: Partial<CheckMeta> = {}): CheckMeta => ({
  id,
  kind: 'functional',
  tier: 'focused',
  head: '<script>window.__prerelease_test=true</script>',
  ...extra,
});

const startsDuringLoad = testCheck('test-start-deferred', {
  startDuringLoad: true,
});
const loadError = testCheck('test-load-error');

/**
 * Tests that a `loadVia: 'http'` target runs checks from the fixture server
 * as an 'html' one runs them in memory: beforeRrweb before rrweb, a start
 * during load, and a fresh Window for every page. `driver` is read once the
 * caller's beforeAll has set it.
 */
export function overHttpTests(driver: () => PageDriver, timeoutMs: number) {
  let server: FixtureServer;
  let src: PageSource;
  let savedPort: string | undefined;

  beforeAll(async () => {
    savedPort = process.env.PRERELEASE_HTTP_PORT;
    process.env.PRERELEASE_HTTP_PORT = '0';
    const bundle = await buildPageBundle();
    const rrweb = readRrwebUmd();
    server = await startFixtureServer(
      { bundle, rrweb },
      { extraChecks: [startsDuringLoad, loadError] },
    );
    src = { bundle, rrweb, httpOrigin: server.origin, loadVia: 'http' };
  });

  afterAll(async () => {
    await server?.close();
    if (savedPort === undefined) delete process.env.PRERELEASE_HTTP_PORT;
    else process.env.PRERELEASE_HTTP_PORT = savedPort;
  });

  const attempt = (meta: CheckMeta) =>
    runAttempt(driver(), meta, src, { timeoutMs });
  const registered = (id: string) => checks.find((c) => c.id === id)!;

  test.each(['snapshot-basic', 'privacy-mask-all-inputs'])(
    '%s passes over http',
    { timeout: timeoutMs + 10_000 },
    async (id) => {
      const r = await attempt(registered(id));
      expect(r.message ?? '').toBe('');
      expect(r.ok).toBe(true);
    },
  );

  test(
    'beforeRrweb runs before rrweb over http',
    { timeout: 2 * timeoutMs + 10_000 },
    async () => {
      expect(await attempt(loadError)).toMatchObject({
        ok: false,
        message: expect.stringContaining('page error: early boom'),
      });
      const r = await attempt(registered('patched-mutation-observer'));
      expect(r.message ?? '').toBe('');
      expect(r.ok).toBe(true);
    },
  );

  test(
    'a check that starts during load runs over http',
    { timeout: timeoutMs + 10_000 },
    async () => {
      // runAttempt never calls start for it, so only the page's own start
      // call can finish it.
      expect(await attempt(startsDuringLoad)).toMatchObject({ ok: true });
      expect(await driver().evaluate('window.__prerelease_test_ran')).toBe(
        true,
      );
    },
  );

  test('opening the same check again gets a fresh Window', async () => {
    const url = `${server.origin}/check/snapshot-basic`;
    await driver().open(url);
    await driver().evaluate('(window.__realm_marker = 1)');
    await driver().open(url);
    expect(await driver().evaluate('typeof window.__realm_marker')).toBe(
      'undefined',
    );
  });
}
