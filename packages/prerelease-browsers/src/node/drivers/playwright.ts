import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import type { Engine } from '../../types.ts';
import type { BrowserInfo, PageDriver } from './types.ts';

type PlaywrightModule = typeof import('playwright');

const browserTypeName = {
  chromium: 'chromium',
  gecko: 'firefox',
  webkit: 'webkit',
} as const;

async function loadPlaywright(path?: string): Promise<PlaywrightModule> {
  if (!path) return import('playwright');
  // require resolves both a package directory and a file path.
  return createRequire(import.meta.url)(resolve(path)) as PlaywrightModule;
}

/**
 * Chromium rounds performance.memory and refreshes it rarely unless asked
 * for precise values; gc() lets a scenario collect before it reads the heap.
 */
export const chromiumHeapArgs = [
  '--enable-precise-memory-info',
  '--js-flags=--expose-gc',
];

export async function launchPlaywright(opts: {
  engine: Engine;
  channel?: string;
  executablePath?: string;
  playwrightModule?: string;
  args?: string[];
}): Promise<PageDriver> {
  const playwright = await loadPlaywright(opts.playwrightModule);
  const browser = await playwright[browserTypeName[opts.engine]].launch({
    channel: opts.channel,
    executablePath: opts.executablePath,
    args:
      opts.engine === 'chromium'
        ? [...chromiumHeapArgs, ...(opts.args ?? [])]
        : opts.args,
  });
  try {
    const page = await (await browser.newContext()).newPage();
    return playwrightDriver(page, {
      canReachLocalhost: true,
      close: () => browser.close(),
    });
  } catch (err) {
    await browser.close();
    throw err;
  }
}

/**
 * Wraps a Playwright page. Unless `singleTab` is set, every load after the
 * first opens a fresh page in the same context and closes the old one.
 */
export function playwrightDriver(
  page: Page,
  extra: {
    canReachLocalhost: boolean;
    describe?: () => Promise<Partial<BrowserInfo>>;
    close: () => Promise<void>;
    singleTab?: boolean;
  },
): PageDriver {
  let current = page;
  let used = false;

  async function pageForLoad(): Promise<Page> {
    if (used && !extra.singleTab) {
      const next = await current.context().newPage();
      await current.close();
      current = next;
    }
    used = true;
    return current;
  }

  return {
    canReachLocalhost: extra.canReachLocalhost,
    async loadHtml(html) {
      await (await pageForLoad()).setContent(html, { waitUntil: 'load' });
    },
    async open(url) {
      await (await pageForLoad()).goto(url, { waitUntil: 'load' });
    },
    evaluate<T>(expression: string) {
      return current.evaluate(expression) as Promise<T>;
    },
    async describe() {
      const browser = current.context().browser();
      const fromPage = await current.evaluate(() => ({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
      }));
      return {
        browserName: browser?.browserType().name() ?? 'unknown',
        browserVersion: browser?.version() ?? 'unknown',
        ...fromPage,
        ...(await extra.describe?.()),
      };
    },
    close: extra.close,
  };
}
