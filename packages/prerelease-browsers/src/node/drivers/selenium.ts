import { Builder } from 'selenium-webdriver';
import type { WebDriver } from 'selenium-webdriver';
import type { PageDriver } from './types.ts';
import { RealmReuseError } from './types.ts';

export { RealmReuseError };

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
 * starts, for example to stop the driver process. `session` adds a grid's
 * own session calls, which need the raw WebDriver.
 */
export async function connectSelenium(opts: {
  serverUrl: string;
  capabilities: Record<string, unknown>;
  canReachLocalhost: boolean;
  onClose?: () => Promise<void>;
  session?: (
    driver: WebDriver,
  ) => Pick<PageDriver, 'markSession' | 'sessionUrl'>;
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

  /** Navigates to a blank URL no load used before; true if the Window stayed. */
  async function blankKeepsWindow(): Promise<boolean> {
    await driver.get(`about:blank?n=${++loads}`);
    return (
      (await driver.executeScript(`return window.${reuseMarker} === true;`)) ===
      true
    );
  }

  /** Moves the session into a new tab and closes the one it was in. */
  async function moveToFreshTab(): Promise<void> {
    const old = await driver.getWindowHandle();
    try {
      await driver.switchTo().newWindow('tab');
    } catch (err) {
      throw new RealmReuseError(
        `navigating to a blank page kept the previous Window, and the browser could not open a new tab: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const fresh = await driver.getWindowHandle();
    await driver.switchTo().window(old);
    await driver.close();
    await driver.switchTo().window(fresh);
  }

  return {
    ...opts.session?.(driver),
    canReachLocalhost: opts.canReachLocalhost,
    async loadHtml(html) {
      // A navigation, not just document.open(), so each page gets a new
      // Window: open() keeps the Window and every global on it. The URL is
      // new every time, so no engine can skip it as a same-URL navigation.
      if (await blankKeepsWindow()) {
        // Some engines keep the Window across this navigation. A new tab is
        // a new browsing context, so it cannot hold the old Window.
        await moveToFreshTab();
        if (await blankKeepsWindow()) {
          throw new RealmReuseError(
            'navigating to a blank page kept the previous Window, and so did a new tab; pages would share globals',
          );
        }
      }
      await driver.executeScript(writePage, html);
      await waitForLoad();
    },
    async open(url) {
      await driver.get(url);
      await waitForLoad();
    },
    evaluate<T>(expression: string) {
      return driver.executeScript<T>(`return (${expression});`);
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
