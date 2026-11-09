import { startFixtureServer } from '../src/node/fixture-server.ts';
import type { FixtureServer } from '../src/node/fixture-server.ts';

let server: FixtureServer;

beforeAll(async () => {
  // Free ports, so parallel test files never collide on 8123.
  process.env.PRERELEASE_HTTP_PORT ??= '0';
  server = await startFixtureServer({ bundle: '', rrweb: '' });
});

afterAll(async () => {
  await server?.close();
});

/**
 * css-early-linked-stylesheet is only meaningful while slow.css is slow,
 * uncacheable and served once per nonce: otherwise the replay, or a cache,
 * can supply the CSS that rrweb failed to record.
 */
describe('slow.css', () => {
  test('is slow, uncacheable and one-shot per nonce', async () => {
    const url = `${server.origin}/assets/slow.css?once=a${Date.now()}`;
    const started = Date.now();
    const first = await fetch(url);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(await first.text()).toContain('#early');

    const again = await fetch(url);
    expect(again.status).toBe(404);
    expect(again.headers.get('cache-control')).toBe('no-store');
    expect(await again.text()).toBe('');
  });

  test('a repeat that arrives while the first is pending is refused too', async () => {
    const url = `${server.origin}/assets/slow.css?once=b${Date.now()}`;
    const first = fetch(url);
    await new Promise((r) => setTimeout(r, 50));
    expect((await fetch(url)).status).toBe(404);
    expect((await first).status).toBe(200);
  });

  test('another nonce is served again', async () => {
    const stamp = Date.now();
    await fetch(`${server.origin}/assets/slow.css?once=c${stamp}`);
    const other = await fetch(
      `${server.origin}/assets/slow.css?once=d${stamp}`,
    );
    expect(other.status).toBe(200);
  });

  test('without a nonce it is served every time', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${server.origin}/assets/slow.css`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('#early');
    }
  });
});
