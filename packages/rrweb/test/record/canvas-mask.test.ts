/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import type { CanvasMaskRegion, CanvasMasking } from '@rrweb/types';
import {
  computeFrameMaskRegions,
  getCanvasContentBoxSize,
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

describe('canvas content-box region scaling', () => {
  it('uses the content box, not clientWidth, so padding does not skew the scale', () => {
    const canvasEl = document.createElement('canvas');
    canvasEl.width = 100;
    canvasEl.height = 100;
    canvasEl.style.padding = '20px';
    document.body.appendChild(canvasEl);

    // jsdom performs no layout, so getBoundingClientRect/clientWidth are
    // stubbed to reflect what a real browser would report: a 100x100
    // backing store padded by 20px on every side renders in a 140x140
    // border box, while clientWidth (border box minus border) is also 140.
    canvasEl.getBoundingClientRect = () =>
      ({ width: 140, height: 140 } as DOMRect);
    Object.defineProperty(canvasEl, 'clientWidth', { value: 140 });
    Object.defineProperty(canvasEl, 'clientHeight', { value: 140 });

    const contentBox = getCanvasContentBoxSize(canvasEl);
    expect(contentBox).toEqual({ width: 100, height: 100 });

    // Regions expressed in content-box CSS pixels must come back unscaled
    // (scale 1) once the content box is used, even though naively using
    // clientWidth (140) would have shrunk every coordinate incorrectly.
    expect(
      computeFrameMaskRegions(
        { maskRegions: () => [region] },
        canvasEl,
        canvasEl.width,
        canvasEl.height,
        contentBox!.width,
        contentBox!.height,
      ),
    ).toEqual([region]);

    document.body.removeChild(canvasEl);
  });

  it('reports no content box (fail closed) when the content box has zero area', () => {
    const canvasEl = document.createElement('canvas');
    canvasEl.width = 100;
    canvasEl.height = 100;
    canvasEl.getBoundingClientRect = () => ({ width: 0, height: 0 } as DOMRect);
    document.body.appendChild(canvasEl);

    expect(getCanvasContentBoxSize(canvasEl)).toBeNull();

    document.body.removeChild(canvasEl);
  });
});
