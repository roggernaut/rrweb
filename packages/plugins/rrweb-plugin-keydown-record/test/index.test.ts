import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { createServer, ViteDevServer } from 'vite';
import * as puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';
import { EventType, type eventWithTime, type pluginEvent } from '@rrweb/types';
import { PLUGIN_NAME, type KeydownPayload } from '../src/index';

async function keydownPayloads(page: Page) {
  const events = await page.evaluate(
    () => (window as any).snapshots as eventWithTime[],
  );
  return events
    .filter(
      (e): e is pluginEvent<KeydownPayload> & { timestamp: number } =>
        e.type === EventType.Plugin && e.data.plugin === PLUGIN_NAME,
    )
    .map((e) => e.data.payload);
}

describe('rrweb-plugin-keydown-record', () => {
  let server: ViteDevServer;
  let serverUrl: string;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    server = await createServer({
      preview: { port: 3000 },
      mode: 'test',
      server: { hmr: false },
    });
    await server.listen();
    serverUrl = server.resolvedUrls!.local[0];
    browser = await puppeteer.launch({
      headless: process.env.PUPPETEER_HEADLESS ? true : false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
    await server.close();
  });

  it('records non-printable keys and shortcuts with the target id, not typed text', async () => {
    await page.goto(`${serverUrl}test/html/index.html`);
    await page.focus('#text');
    await page.keyboard.type('abc');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Escape');

    const payloads = await keydownPayloads(page);
    const textId = await page.evaluate(() =>
      (window as any).mirror.getId(document.querySelector('#text')),
    );

    expect(payloads.map((p) => p.key)).toEqual(['Enter', 'Tab', 'a', 'Escape']);
    expect(payloads[2]).toMatchObject({ ctrlKey: true, code: 'KeyA' });
    // Enter was pressed while #text was focused; Tab moved focus on, so Control+A targets the next field.
    expect(payloads[0].targetId).toBe(textId);
    expect(payloads[2].targetId).not.toBe(textId);
    expect(
      payloads.every((p) => typeof p.targetId === 'number' && p.targetId > 0),
    ).toBe(true);
  });

  it('never records printable keys in a password field, even when opted in', async () => {
    await page.goto(`${serverUrl}test/html/index.html?recordPrintable=true`);
    await page.focus('#password');
    await page.keyboard.type('hunter2');
    await page.keyboard.press('Enter');
    await page.focus('#text');
    await page.keyboard.type('x');

    const payloads = await keydownPayloads(page);
    expect(payloads.map((p) => p.key)).toEqual(['Enter', 'x']);
  });

  it('skips targets matching the ignore selector', async () => {
    await page.goto(`${serverUrl}test/html/index.html`);
    await page.focus('#ignored');
    await page.keyboard.press('Enter');
    await page.focus('#text');
    await page.keyboard.press('Enter');

    const payloads = await keydownPayloads(page);
    expect(payloads).toHaveLength(1);
  });
});
