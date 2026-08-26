import { describe, expect, it, vi } from 'vitest';
// Imported from its own module, not re-exported through `src/record`: this is
// an internal fail-closed helper, not part of rrweb's public surface.
import { resolveCanvasSampling } from '../../src/record/canvas-sampling';
import { isCanvasMaskingConfigured } from '../../src/record/observers/canvas/canvas-mask';
import type { CanvasMasking } from '@rrweb/types';

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
