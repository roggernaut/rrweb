import type { PageDriver } from '../src/node/drivers/types.ts';
import type { AttemptResult } from '../src/types.ts';

/**
 * A driver with no browser behind it. It speaks the page protocol and answers
 * the nth page load (counting from 1) with `next(n)`. `onLoad` runs as each
 * page loads, so a test can move the deadline while an attempt is in flight.
 */
export function scriptedDriver(
  next: (n: number) => AttemptResult,
  onLoad: (n: number) => void = () => undefined,
): PageDriver & { loads: number } {
  let result = '';
  const load = async () => {
    driver.loads++;
    onLoad(driver.loads);
    result = JSON.stringify(next(driver.loads));
  };
  const driver = {
    loads: 0,
    canReachLocalhost: true,
    loadHtml: load,
    open: load,
    async evaluate<T>(expression: string): Promise<T> {
      if (expression === '__prerelease.poll()') {
        return { state: 'done', length: result.length } as T;
      }
      const read = /^__prerelease\.read\((\d+)\)$/.exec(expression);
      if (read) return result.slice(Number(read[1])) as T;
      return undefined as T;
    },
    describe: async () => ({
      browserName: 'scripted',
      browserVersion: '0',
      platform: 'test',
      userAgent: 'scripted',
    }),
    close: async () => undefined,
  };
  return driver;
}
