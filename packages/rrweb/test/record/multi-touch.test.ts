import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import { vi } from 'vitest';

import { getServerURL, ISuite, launchPuppeteer, startServer } from '../utils';
import {
  EventType,
  eventWithTime,
  IncrementalSource,
  listenerHandler,
  MouseInteractions,
} from '@rrweb/types';
import type { recordOptions } from '../../src/types';

interface IWindow extends Window {
  rrweb: {
    record: (
      options: recordOptions<eventWithTime>,
    ) => listenerHandler | undefined;
  };
  emit: (e: eventWithTime) => undefined;
}

type TouchPoint = { x: number; y: number; id: number };

describe('multi-touch', () => {
  vi.setConfig({ testTimeout: 100_000 });
  let browser: ISuite['browser'];
  let server: ISuite['server'];
  let serverURL: ISuite['serverURL'];
  let page: ISuite['page'];
  let cdp: puppeteer.CDPSession;
  let events: ISuite['events'];

  beforeAll(async () => {
    server = await startServer();
    serverURL = getServerURL(server);
    browser = await launchPuppeteer();
  });

  afterAll(async () => {
    await server.close();
    await browser.close();
  });

  afterEach(async () => {
    await page.close();
  });

  const startRecording = async (options: recordOptions<eventWithTime> = {}) => {
    page = await browser.newPage();
    await page.setViewport({
      width: 400,
      height: 600,
      hasTouch: true,
      isMobile: true,
    });
    await page.goto(`${serverURL}/html/touch.html`);
    await page.addScriptTag({
      path: path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
    });
    cdp = await page.target().createCDPSession();
    events = [];
    await page.exposeFunction('emit', (e: eventWithTime) => {
      events.push(e);
    });
    await page.evaluate((options) => {
      const { record } = (window as unknown as IWindow).rrweb;
      record({
        emit: (window as unknown as IWindow).emit,
        // record every move, and flush them quickly
        sampling: { mousemove: 1, mousemoveCallback: 20 },
        ...options,
      });
    }, options);
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const touch = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    touchPoints: TouchPoint[],
  ) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    await sleep(30);
  };

  const touchInteractions = () =>
    events.flatMap((e) =>
      e.type === EventType.IncrementalSnapshot &&
      e.data.source === IncrementalSource.MouseInteraction
        ? [
            {
              type: MouseInteractions[e.data.type],
              pointerId: e.data.pointerId,
            },
          ]
        : [],
    );
  const touchMoves = () =>
    events.flatMap((e) =>
      e.type === EventType.IncrementalSnapshot &&
      e.data.source === IncrementalSource.TouchMove
        ? [
            {
              pointerId: e.data.pointerId,
              xs: e.data.positions.map((p) => p.x),
            },
          ]
        : [],
    );

  it('records the start and end of every finger with its identifier', async () => {
    await startRecording();
    const a = { x: 100, y: 200, id: 0 };
    const b = { x: 300, y: 400, id: 1 };
    await touch('touchStart', [a]);
    await touch('touchStart', [a, b]);
    await touch('touchEnd', [b]); // b lifts
    await touch('touchEnd', []); // a lifts

    expect(touchInteractions()).toEqual([
      { type: 'TouchStart', pointerId: 0 },
      { type: 'TouchStart', pointerId: 1 },
      { type: 'TouchEnd', pointerId: 1 },
      { type: 'TouchEnd', pointerId: 0 },
    ]);
  });

  it('records the end of a touch that scrolls the page', async () => {
    await startRecording();
    // below the pad, so the browser takes over the touch to scroll
    await touch('touchStart', [{ x: 200, y: 580, id: 0 }]);
    await touch('touchMove', [{ x: 200, y: 540, id: 0 }]);
    await touch('touchMove', [{ x: 200, y: 500, id: 0 }]);
    await touch('touchEnd', []);
    await sleep(100);

    expect(touchInteractions()).toEqual([
      { type: 'TouchStart', pointerId: 0 },
      { type: 'TouchEnd', pointerId: 0 },
    ]);
    expect(touchMoves().map((m) => m.pointerId)).toEqual([0, 0]);
  });

  it('follows a single finger by default', async () => {
    await startRecording();
    const a = { x: 100, y: 200, id: 0 };
    const b = { x: 300, y: 400, id: 1 };
    await touch('touchStart', [a, b]);
    // only b moves, then only a moves
    await touch('touchMove', [a, { ...b, x: 310 }]);
    await touch('touchMove', [a, { ...b, x: 320 }]);
    await touch('touchMove', [
      { ...a, x: 110 },
      { ...b, x: 320 },
    ]);
    await touch('touchMove', [
      { ...a, x: 120 },
      { ...b, x: 320 },
    ]);
    await touch('touchEnd', []);
    await sleep(100);

    const moves = touchMoves();
    expect(moves.every((m) => m.pointerId === 0)).toBe(true);
    expect(moves.flatMap((m) => m.xs)).toEqual([110, 120]);
  });

  it('records every finger with recordMultiTouch', async () => {
    await startRecording({ recordMultiTouch: true });
    const a = { x: 200, y: 300, id: 0 };
    const b = { x: 220, y: 300, id: 1 };
    await touch('touchStart', [a, b]);
    // pinch out
    await touch('touchMove', [
      { ...a, x: 190 },
      { ...b, x: 230 },
    ]);
    await touch('touchMove', [
      { ...a, x: 180 },
      { ...b, x: 240 },
    ]);
    await touch('touchEnd', []);
    await sleep(100);

    const byPointer = (pointerId: number) =>
      touchMoves()
        .filter((m) => m.pointerId === pointerId)
        .flatMap((m) => m.xs);
    expect(byPointer(0)).toEqual([190, 180]);
    expect(byPointer(1)).toEqual([230, 240]);
  });

  it('records the visual viewport when pinch-zooming', async () => {
    await startRecording();
    await cdp.send('Input.synthesizePinchGesture', {
      x: 200,
      y: 300,
      scaleFactor: 2,
      relativeSpeed: 800,
    });
    await sleep(300);

    const viewports = events.flatMap((e) =>
      e.type === EventType.IncrementalSnapshot &&
      e.data.source === IncrementalSource.VisualViewport
        ? [e.data]
        : [],
    );
    expect(viewports.length).toBeGreaterThan(1);
    const last = viewports[viewports.length - 1];
    expect(last.scale).toBeCloseTo(2, 1);
    expect(last.offsetLeft).toBeGreaterThan(0);
    expect(last.offsetTop).toBeGreaterThan(0);
  });
});
