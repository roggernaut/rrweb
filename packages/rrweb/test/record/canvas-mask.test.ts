/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import type { CanvasMaskRegion, CanvasMasking } from '@rrweb/types';
import {
  computeFrameMaskRegions,
  getCanvasContentBoxSize,
  isCanvasMaskingConfigured,
  resolveCanvasSampling,
  resolveFrameDisplaySize,
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

/**
 * `record()` composes exactly this pair, so the tests do too: whether the
 * coercion happens is decided by *configured* semantics, not by the mere
 * presence of a `canvasMasking` object.
 */
const resolveFor = (
  requested: number | 'all' | undefined,
  masking: CanvasMasking | undefined,
) => resolveCanvasSampling(requested, isCanvasMaskingConfigured(masking));

const provider = (over: Partial<CanvasMasking> = {}): CanvasMasking => ({
  maskRegions: () => [],
  ...over,
});

describe('canvas fail-closed', () => {
  it('forces numeric sampling when masking configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveCanvasSampling('all', true)).toBe(4);
    expect(resolveCanvasSampling(undefined, true)).toBe(4);
    expect(resolveCanvasSampling(15, true)).toBe(15);
    expect(resolveCanvasSampling('all', false)).toBe('all');
    warn.mockRestore();
  });

  it('warns once per forced resolution so silent bypass is never possible', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveCanvasSampling('all', true);
    expect(warn).toHaveBeenCalledWith(
      '[rrweb] canvasMasking requires FPS canvas capture; forcing sampling.canvas = 4',
    );
    warn.mockRestore();
  });

  it('does not warn when a numeric sampling is already provided', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveCanvasSampling(30, true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('canvas sampling keys on configured semantics, not presence', () => {
  it('coerces for a provider with no isConfigured switch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveFor('all', provider())).toBe(4);
    warn.mockRestore();
  });

  it('coerces for a provider whose isConfigured() is true', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveFor('all', provider({ isConfigured: () => true }))).toBe(4);
    warn.mockRestore();
  });

  /**
   * `isConfigured() === false` means masking is switched off, so mutation-mode
   * capture redacts nothing but also bypasses nothing. Coercing there would
   * downgrade a legitimate command-stream recording for no privacy gain.
   */
  it('preserves mutation-mode sampling when isConfigured() is false', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const masking = provider({ isConfigured: () => false });
    expect(resolveFor('all', masking)).toBe('all');
    expect(resolveFor(undefined, masking)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still coerces when the isConfigured switch itself throws (fail closed)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolveFor(
        'all',
        provider({
          isConfigured: () => {
            throw new Error('boom');
          },
        }),
      ),
    ).toBe(4);
    warn.mockRestore();
  });

  it('leaves sampling alone with no canvasMasking at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveFor('all', undefined)).toBe('all');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

/**
 * The frame loop used to measure the content box whenever a `canvasMasking`
 * object was merely *present*. A provider whose `isConfigured()` returns false
 * masks nothing, so the measurement was unused -- and on a canvas that cannot
 * be measured (zero content box) the frame was dropped anyway, losing capture
 * for no privacy gain.
 */
describe('resolveFrameDisplaySize', () => {
  const canvasOf = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };

  it('uses cheap client dimensions, and does not measure, with no provider', () => {
    const canvas = canvasOf(300, 150);
    const rect = vi.spyOn(canvas, 'getBoundingClientRect');
    expect(resolveFrameDisplaySize(undefined, canvas)).toEqual({
      width: 300,
      height: 150,
    });
    expect(rect).not.toHaveBeenCalled();
  });

  it('captures the frame from client dimensions when isConfigured() is false', () => {
    const canvas = canvasOf(300, 150);
    const rect = vi.spyOn(canvas, 'getBoundingClientRect');
    const style = vi.spyOn(window, 'getComputedStyle');

    const size = resolveFrameDisplaySize(
      { maskRegions: () => [], isConfigured: () => false },
      canvas,
    );

    // not SKIP_FRAME: the frame is still captured, unmeasurable or not
    expect(size).toEqual({ width: 300, height: 150 });
    expect(rect).not.toHaveBeenCalled();
    expect(style).not.toHaveBeenCalled();
    style.mockRestore();
  });

  it('measures the content box when masking is in force', () => {
    const canvas = canvasOf(300, 150);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 100,
    } as DOMRect);
    expect(resolveFrameDisplaySize({ maskRegions: () => [] }, canvas)).toEqual({
      width: 200,
      height: 100,
    });
  });

  /** Fail closed: a wrong scale would leave mask regions off their target. */
  it('skips the frame when masking is in force but the box is unmeasurable', () => {
    const canvas = canvasOf(300, 150);
    expect(resolveFrameDisplaySize({ maskRegions: () => [] }, canvas)).toBe(
      SKIP_FRAME,
    );
  });
});
