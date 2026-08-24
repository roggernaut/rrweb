import { describe, expect, it } from 'vitest';
import type { CanvasMaskRegion, CanvasMasking } from '@rrweb/types';
import {
  computeFrameMaskRegions,
  isCanvasMaskingConfigured,
  SKIP_FRAME,
} from '../../src/record/observers/canvas/canvas-mask';

const canvas = {} as HTMLCanvasElement;
const region = { x: 10, y: 20, width: 30, height: 40 };

describe('canvas privacy masking', () => {
  it('does not change capture without a configured provider', () => {
    expect(
      computeFrameMaskRegions(undefined, canvas, 100, 50, 100, 50),
    ).toBeUndefined();
    expect(
      computeFrameMaskRegions(
        {
          isConfigured: () => false,
          maskRegions: () => {
            throw new Error('must not run');
          },
        },
        canvas,
        100,
        50,
        100,
        50,
      ),
    ).toBeUndefined();
  });

  it('scales CSS-pixel regions and rounds outward', () => {
    expect(
      computeFrameMaskRegions(
        { maskRegions: () => [region] },
        canvas,
        33,
        33,
        100,
        100,
      ),
    ).toEqual([{ x: 3, y: 6, width: 11, height: 14 }]);
  });

  it('drops zero-area regions without inflating fractional coordinates', () => {
    expect(
      computeFrameMaskRegions(
        {
          maskRegions: () => [{ x: 5.5, y: 0, width: 0, height: 40 }, region],
        },
        canvas,
        50,
        25,
        100,
        50,
      ),
    ).toEqual([{ x: 5, y: 10, width: 15, height: 20 }]);
  });

  it('preserves an explicit empty region list as a provider-owned frame', () => {
    expect(
      computeFrameMaskRegions(
        { maskRegions: () => [] },
        canvas,
        100,
        50,
        100,
        50,
      ),
    ).toEqual([]);
  });

  it.each<[string, CanvasMasking]>([
    ['a null result', { maskRegions: () => null }],
    ['an undefined result', { maskRegions: () => undefined }],
    [
      'a thrown error',
      {
        maskRegions: () => {
          throw new Error('boom');
        },
      },
    ],
    [
      'a malformed rectangle',
      { maskRegions: () => [{}] as CanvasMaskRegion[] },
    ],
    [
      'a partially malformed list',
      { maskRegions: () => [region, {}] as CanvasMaskRegion[] },
    ],
    [
      'negative dimensions',
      {
        maskRegions: () => [{ x: 0, y: 0, width: -1, height: 10 }],
      },
    ],
  ])('skips the frame for %s', (_name, masking) => {
    expect(computeFrameMaskRegions(masking, canvas, 100, 50, 100, 50)).toBe(
      SKIP_FRAME,
    );
  });

  it('fails closed when the dynamic configured check throws', () => {
    expect(
      isCanvasMaskingConfigured({
        isConfigured: () => {
          throw new Error('boom');
        },
        maskRegions: () => [],
      }),
    ).toBe(true);
  });
});
