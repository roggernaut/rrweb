import { Builder } from 'selenium-webdriver';
import type { WebDriver } from 'selenium-webdriver';
import type { PageDriver } from './types.ts';

const loadTimeoutMs = 60_000;
const loadPollMs = 50;

/**
 * Set on each blank Window before a page is written into it. Finding it
 * after the next navigation means the engine kept the old Window, so globals
 * one check replaced would leak into the next.
 */
const reuseMarker = '__prerelease_driver_load';

const writePage = `
  window.${reuseMarker} = true;
  document.open();
  document.write(arguments[0]);
  document.close();
`;

/**
 * Opens a WebDriver session on `serverUrl`, for geckodriver, safaridriver or
 * a remote grid. `onClose` runs after the session quits, or when no session
 * starts, for example to stop the driver process.
 */
export async function connectSelenium(opts: {
  serverUrl: string;
  capabilities: Record<string, unknown>;
  canReachLocalhost: boolean;
  onClose?: () => Promise<void>;
}): Promise<PageDriver> {
  let driver: WebDriver;
  try {
    // Without this, SELENIUM_REMOTE_URL and SELENIUM_BROWSER in the
    // environment would silently send the session somewhere else.
    driver = await new Builder()
      .disableEnvironmentOverrides()
      .usingServer(opts.serverUrl)
      .withCapabilities(opts.capabilities)
      .build();
  } catch (err) {
    await opts.onClose?.();
    throw err;
  }

  async function waitForLoad(): Promise<void> {
    const giveUpAt = Date.now() + loadTimeoutMs;
    while (
      (await driver.executeScript('return document.readyState;')) !== 'complete'
    ) {
      if (Date.now() >= giveUpAt) {
        throw new Error(`page did not finish loading in ${loadTimeoutMs} ms`);
      }
      await new Promise((r) => setTimeout(r, loadPollMs));
    }
  }

  let loads = 0;

  return {
    canReachLocalhost: opts.canReachLocalhost,
    async loadHtml(html) {
      // A navigation, not just document.open(), so each page gets a new
      // Window: open() keeps the Window and every global on it. The URL is
      // new every time, so no engine can skip it as a same-URL navigation.
      const blank = `about:blank?n=${++loads}`;
      await driver.get(blank);
      if (
        await driver.executeScript(`return window.${reuseMarker} === true;`)
      ) {
        throw new Error(
          `navigating to ${blank} kept the previous Window; pages would share globals`,
        );
      }
      await driver.executeScript(writePage, html);
      await waitForLoad();
    },
    async open(url) {
      await driver.get(url);
      await waitForLoad();
    },
    evaluate<T>(expression: string) {
      return driver.executeScript(`return (${expression});`) as Promise<T>;
    },
    async describe() {
      const caps = await driver.getCapabilities();
      const userAgent = await driver.executeScript<string>(
        'return navigator.userAgent;',
      );
      return {
        browserName: String(caps.get('browserName') ?? 'unknown'),
        browserVersion: String(caps.get('browserVersion') ?? 'unknown'),
        platform: String(caps.get('platformName') ?? 'unknown'),
        userAgent,
      };
    },
    async close() {
      try {
        await driver.quit();
      } finally {
        await opts.onClose?.();
      }
    },
  };
}
