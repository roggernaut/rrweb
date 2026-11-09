// Launches WebKit through Playwright; `yarn test:browser` runs it.
import { webkit } from 'playwright';
import { playwrightDriver } from '../src/node/drivers/playwright.ts';

describe('single-tab Playwright driver', () => {
  test('every load gets a fresh Window', async () => {
    const browser = await webkit.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      const driver = playwrightDriver(page, {
        canReachLocalhost: false,
        close: () => browser.close(),
        singleTab: true,
      });
      await driver.loadHtml('<p>one</p>');
      await driver.evaluate(
        '(window.leaked = 1, window.MutationObserver = function () {}, 0)',
      );
      await driver.loadHtml('<p>two</p>');
      expect(await driver.evaluate('typeof window.leaked')).toBe('undefined');
      expect(
        await driver.evaluate(
          'String(window.MutationObserver).includes("[native code]")',
        ),
      ).toBe(true);
      expect(await driver.evaluate('document.body.textContent')).toBe('two');
      expect(browser.contexts()[0].pages()).toHaveLength(1);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
