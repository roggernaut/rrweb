import * as fs from 'fs';
import * as path from 'path';
import { vi } from 'vitest';
import type * as puppeteer from 'puppeteer';
import { launchPuppeteer, waitForRAF } from '../utils';
import events from '../events/multi-touch';

interface ISuite {
  code: string;
  browser: puppeteer.Browser;
  page: puppeteer.Page;
}

type Indicator = { left: string; top: string; active: boolean };

describe('replay multi-touch', function () {
  vi.setConfig({ testTimeout: 20_000, hookTimeout: 30_000 });

  let code: ISuite['code'];
  let browser: ISuite['browser'];
  let page: ISuite['page'];

  beforeAll(async () => {
    browser = await launchPuppeteer();
    const bundlePath = path.resolve(__dirname, '../../dist/rrweb.umd.cjs');
    code = fs.readFileSync(bundlePath, 'utf8');
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto('about:blank');
    await page.evaluate(code);
    await page.evaluate(`let events = ${JSON.stringify(events)}`);
    await page.evaluate(`
      const { Replayer } = rrweb;
      window.replayer = new Replayer(events);
    `);
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  });

  afterEach(async () => {
    await page.close();
  });

  afterAll(async () => {
    await browser.close();
  });

  const indicatorsAt = async (offset: number): Promise<Indicator[]> => {
    await page.evaluate(`replayer.pause(${offset})`);
    await waitForRAF(page);
    return page.evaluate(() =>
      Array.from(document.querySelectorAll('.replayer-mouse')).map((el) => {
        const { left, top } = (el as HTMLElement).style;
        return { left, top, active: el.classList.contains('touch-active') };
      }),
    );
  };

  it('shows one indicator per finger', async () => {
    // first finger down
    expect(await indicatorsAt(1050)).toEqual([
      { left: '100px', top: '300px', active: true },
    ]);
    // both fingers down, the second one has moved
    expect(await indicatorsAt(1350)).toEqual([
      { left: '100px', top: '300px', active: true },
      { left: '240px', top: '300px', active: true },
    ]);
    // second finger lifted: its indicator is gone
    expect(await indicatorsAt(1550)).toEqual([
      { left: '100px', top: '300px', active: true },
    ]);
    // all fingers lifted
    expect(await indicatorsAt(1650)).toEqual([
      { left: '100px', top: '300px', active: false },
    ]);
  });

  it('removes extra indicators when seeking back', async () => {
    expect(await indicatorsAt(1350)).toHaveLength(2);
    expect(await indicatorsAt(500)).toHaveLength(1);
  });

  it('ends every finger on TouchCancel', async () => {
    expect(await indicatorsAt(2050)).toEqual([
      { left: '150px', top: '450px', active: true },
    ]);
    expect(await indicatorsAt(2150)).toEqual([
      { left: '150px', top: '450px', active: false },
    ]);
  });
});
