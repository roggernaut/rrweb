import { chromium, type CDPSession, type Page } from 'playwright';
import type { eventWithTime } from '@rrweb/types';
import { FfmpegJpegPipe } from './ffmpeg';
import { shouldUseBeginFrame } from './config';
import { getHtml } from './replay-html';
import { estimateFrameCount, getSessionDurationMs } from './timeline';
import type { ResolvedRRvideoConfig, ViewportSize } from './types';

export const CHROMIUM_LAUNCH_ARGS = [
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
  '--autoplay-policy=no-user-gesture-required',
  '--font-render-hinting=none',
  '--hide-scrollbars',
];

/**
 * Hand compositor frame production to the capture loop. Chrome then draws
 * only when `HeadlessExperimental.beginFrame` asks it to, with CSS animation
 * time taken from the frame's `frameTimeTicks`. Requires chrome-headless-shell
 * on Linux; BeginFrame is not implemented on macOS or Windows.
 */
export const BEGIN_FRAME_LAUNCH_ARGS = [
  '--deterministic-mode',
  '--enable-begin-frame-control',
  '--disable-new-content-rendering-timeout',
  '--run-all-compositor-stages-before-draw',
  '--disable-threaded-animation',
  '--disable-threaded-scrolling',
  '--disable-checker-imaging',
  '--disable-image-animation-resync',
  '--enable-surface-synchronization',
];

const FIRST_FRAME_ATTEMPTS = 5;

/** Upper bound on waiting for the first snapshot's images and fonts. */
const ASSET_WAIT_MS = 5000;

type CaptureWindow = {
  replayer: {
    play: () => void;
    getReplayer: () => { getCurrentTime: () => number };
  };
  __rrvideoInitError?: string | null;
  __rrvideoFinished?: boolean;
  __rrvideoClock: {
    advance: (ms: number) => Promise<void>;
    realSetTimeout: typeof setTimeout;
  };
};

type FrameGrabber = () => Promise<Buffer>;

function beginFrameGrabber(
  page: Page,
  cdp: CDPSession,
  config: ResolvedRRvideoConfig,
): FrameGrabber {
  const interval = 1000 / config.fps;
  // Offset from 0 so the first frame is not at the compositor's origin.
  let frameTimeTicks = 1000;
  let previous: Buffer | null = null;

  const beginFrame = async () => {
    const { screenshotData } = await cdp.send(
      'HeadlessExperimental.beginFrame',
      {
        frameTimeTicks,
        interval,
        screenshot: { format: 'jpeg', quality: config.quality },
      },
    );
    frameTimeTicks += interval;
    return screenshotData;
  };

  return async () => {
    let screenshotData = await beginFrame();
    // BeginFrame only returns a screenshot when something was redrawn, and
    // Page.captureScreenshot never resolves under BeginFrame control. Force
    // damage for the first frame by repainting an invisible pixel. One
    // repaint is occasionally not enough, so retry a few times.
    for (
      let attempt = 0;
      !screenshotData && !previous && attempt < FIRST_FRAME_ATTEMPTS;
      attempt++
    ) {
      await page.evaluate(
        (alpha) => {
          let pixel = document.getElementById('__rrvideo-damage');
          if (!pixel) {
            pixel = document.createElement('div');
            pixel.id = '__rrvideo-damage';
            pixel.style.cssText =
              'position:fixed;left:0;top:0;width:1px;height:1px;' +
              'pointer-events:none';
            document.body.appendChild(pixel);
          }
          pixel.style.background = `rgba(0,0,0,${alpha})`;
        },
        attempt % 2 ? 0.002 : 0.001,
      );
      screenshotData = await beginFrame();
    }
    if (screenshotData) {
      previous = Buffer.from(screenshotData, 'base64');
    }
    if (!previous) {
      throw new Error('HeadlessExperimental.beginFrame returned no frame');
    }
    // No damage means the frame is unchanged.
    return previous;
  };
}

function screenshotGrabber(
  cdp: CDPSession,
  config: ResolvedRRvideoConfig,
): FrameGrabber {
  return async () => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: config.quality,
      optimizeForSpeed: true,
    });
    return Buffer.from(data, 'base64');
  };
}

/**
 * Wait (in real time) for the replayed page's images and web fonts.
 *
 * Functions passed to page.evaluate are sent as source text, so they avoid
 * async/await: the ES6 build would turn it into an __awaiter helper that
 * does not exist in the page.
 */
async function waitForReplayAssets(page: Page): Promise<void> {
  await page.evaluate((timeoutMs) => {
    const w = window as unknown as CaptureWindow;
    const iframe = document.querySelector<HTMLIFrameElement>(
      '.replayer-wrapper iframe',
    );
    const doc = iframe?.contentDocument;
    if (!doc) return;
    const loads: Array<Promise<unknown>> = Array.from(doc.images)
      .filter((img) => !img.complete)
      .map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
      );
    if (doc.fonts) loads.push(doc.fonts.ready);
    return Promise.race([
      Promise.all(loads),
      new Promise<void>((resolve) =>
        w.__rrvideoClock.realSetTimeout(resolve, timeoutMs),
      ),
    ]).then(() => undefined);
  }, ASSET_WAIT_MS);
}

export async function captureWithFfmpeg(
  events: eventWithTime[],
  viewport: ViewportSize,
  config: ResolvedRRvideoConfig,
): Promise<string> {
  const speed = config.rrwebPlayer.speed || 1;
  const frameMs = 1000 / config.fps;
  const durationMs = getSessionDurationMs(events);
  // skipInactive can only shorten playback, so this bounds the loop. The
  // margin covers the replayer's finish buffer.
  const maxFrames =
    estimateFrameCount(durationMs, config.fps, speed) + config.fps;
  const useBeginFrame = shouldUseBeginFrame(config);
  const encoder = new FfmpegJpegPipe({
    fps: config.fps,
    outputPath: config.output,
    ffmpegPath: config.ffmpegPath,
    crf: config.crf,
    preset: config.x264Preset,
  });

  const browser = await chromium.launch({
    headless: config.headless,
    args: useBeginFrame
      ? [...CHROMIUM_LAUNCH_ARGS, ...BEGIN_FRAME_LAUNCH_ARGS]
      : CHROMIUM_LAUNCH_ARGS,
  });

  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: config.pixelRatio,
    });
    const page = await context.newPage();
    page.on('console', (msg) => {
      console.log('[PAGE CONSOLE]', msg.type(), msg.text());
    });
    page.on('pageerror', (error) => {
      console.error('[PAGE ERROR]', error.message);
    });
    const cdp = await context.newCDPSession(page);

    await page.setContent(
      getHtml(events, config, {
        scale: 1,
        startPlayback: false,
        virtualClock: true,
      }),
    );
    const initError = await page.evaluate(() => {
      return (window as unknown as CaptureWindow).__rrvideoInitError;
    });
    if (initError) {
      throw new Error(`Failed to initialize rrweb-player: ${initError}`);
    }

    // Starts the replayer at offset 0. Nothing moves until the clock does.
    await page.evaluate(() => {
      (window as unknown as CaptureWindow).replayer.play();
    });
    // rrweb-player sizes the replayer in a setTimeout(0) after mount.
    await page.evaluate(() =>
      (window as unknown as CaptureWindow).__rrvideoClock.advance(0),
    );
    await waitForReplayAssets(page);

    const grab = useBeginFrame
      ? beginFrameGrabber(page, cdp, config)
      : screenshotGrabber(cdp, config);

    // Frame N shows the replay at N * frameMs. The frame after `finish`
    // fires is the last one, so the final state is always in the file.
    let finished = false;
    for (let frame = 0; frame < maxFrames && !finished; frame++) {
      await encoder.write(await grab());
      const status = await page.evaluate((ms) => {
        const w = window as unknown as CaptureWindow;
        return w.__rrvideoClock.advance(ms).then(() => ({
          finished: Boolean(w.__rrvideoFinished),
          currentTime: w.replayer.getReplayer().getCurrentTime(),
        }));
      }, frameMs);
      if (status.finished) {
        finished = true;
        await encoder.write(await grab());
      } else if (durationMs > 0) {
        config.onProgressUpdate(
          Math.min(status.currentTime / durationMs, 0.999),
        );
      }
    }
    config.onProgressUpdate(1);

    await encoder.end();
    await context.close();
  } catch (error) {
    encoder.kill();
    throw error;
  } finally {
    await browser.close();
  }

  return config.output;
}
