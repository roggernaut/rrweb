import { configDefaults, defineProject, mergeConfig } from 'vitest/config';
import configShared from '../../vitest.config.ts';

/**
 * Test files that launch a real browser. `yarn test`, which the main CI job
 * runs, leaves them out; `yarn test:browser` (vitest.config.browser.ts) runs
 * only these.
 */
export const browserTests = [
  'test/checks.chromium.test.ts',
  'test/counterfeits.browser.test.ts',
  'test/playwright.browser.test.ts',
  'test/protocol.test.ts',
  'test/run-target.browser.test.ts',
  // Skips its Firefox tests when geckodriver or Firefox is missing.
  'test/selenium.test.ts',
];

export default mergeConfig(
  configShared,
  defineProject({
    test: {
      globals: true,
      exclude: [...configDefaults.exclude, ...browserTests],
    },
  }),
);
