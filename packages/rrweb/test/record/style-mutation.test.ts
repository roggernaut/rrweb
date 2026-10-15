import * as fs from 'fs';
import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import { vi } from 'vitest';
import type { eventWithTime, listenerHandler } from '@rrweb/types';
import type { recordOptions } from '../../src/types';
import { launchPuppeteer, waitForRAF } from '../utils';

interface IWindow extends Window {
  rrweb: {
    record: (
      options: recordOptions<eventWithTime>,
    ) => listenerHandler | undefined;
  };
  emit: (e: eventWithTime) => undefined;
}

describe('style text mutations', () => {
  vi.setConfig({ testTimeout: 10_000 });

  let browser: puppeteer.Browser;
  let page: puppeteer.Page;
  let code: string;
  let events: eventWithTime[] = [];

  beforeAll(async () => {
    browser = await launchPuppeteer();
    code = fs.readFileSync(
      path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
      'utf8',
    );
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto('about:blank');
    await page.setContent(
      '<style id="sheet">body{color:red}</style><p id="text">secret</p>',
    );
    await page.evaluate(code);
    events = [];
    await page.exposeFunction('emit', (e: eventWithTime) => {
      events.push(e);
    });
  });

  afterEach(async () => {
    await page.close();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('records <style> text mutations verbatim under strict, still masking page text', async () => {
    await page.evaluate(() => {
      const { record } = (window as unknown as IWindow).rrweb;
      record({
        emit: (window as unknown as IWindow).emit,
        privacyPolicy: { version: 1, preset: 'strict' },
      });

      // mutate the existing text nodes in place -> characterData mutations
      (
        document.querySelector('#sheet') as HTMLStyleElement
      ).firstChild!.textContent = '.a{color:blue}';
      (document.querySelector('#text') as HTMLElement).firstChild!.textContent =
        'changed secret';
    });
    await waitForRAF(page);

    const payload = JSON.stringify(events);
    // CSS is never masked, on any path
    expect(payload).toContain('.a{color:blue}');
    // ... while ordinary text still is
    expect(payload).not.toContain('changed secret');
  });
});
