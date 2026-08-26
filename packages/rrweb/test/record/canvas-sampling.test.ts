import { describe, expect, it, vi } from 'vitest';
import { resolveCanvasSampling } from '../../src/record';

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
