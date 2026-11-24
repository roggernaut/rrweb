import { expect, it } from 'vitest';
import { inactiveSkipSpeed } from '../../src/replay/inactivity';
it('scales the target duration with gap length and tempo, respecting the configured ceiling', () => {
  expect(inactiveSkipSpeed(10000, 1, 1000)).toBe(10);
  expect(1500000 / inactiveSkipSpeed(1500000, 1, 1000)).toBeCloseTo(2807, -1);
  expect(inactiveSkipSpeed(60000, 2, 1000)).toBe(
    2 * inactiveSkipSpeed(60000, 1, 1000),
  );
  expect(inactiveSkipSpeed(1500000, 1, 360)).toBe(360);
});
