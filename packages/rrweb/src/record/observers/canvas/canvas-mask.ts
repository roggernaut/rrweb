import type { CanvasMaskRegion, CanvasMasking } from '@rrweb/types';

export const SKIP_FRAME = Symbol('skip-canvas-frame');

export type FrameMaskResult =
  | CanvasMaskRegion[]
  | typeof SKIP_FRAME
  | undefined;

/**
 * Compute and scale application-provided regions before any canvas pixels
 * cross into the encoding worker. Any ambiguous result fails closed.
 */
export function computeFrameMaskRegions(
  masking: CanvasMasking | undefined,
  canvas: HTMLCanvasElement,
  captureWidth: number,
  captureHeight: number,
  displayWidth: number,
  displayHeight: number,
): FrameMaskResult {
  if (!masking || !isCanvasMaskingConfigured(masking)) return undefined;

  let regions: CanvasMaskRegion[] | null | undefined;
  try {
    regions = masking.maskRegions(canvas);
  } catch {
    return SKIP_FRAME;
  }

  if (!Array.isArray(regions) || !regions.every(isValidRegion)) {
    return SKIP_FRAME;
  }

  if (displayWidth <= 0 || displayHeight <= 0) return SKIP_FRAME;
  const scaleX = captureWidth / displayWidth;
  const scaleY = captureHeight / displayHeight;

  return regions
    .filter((region) => region.width > 0 && region.height > 0)
    .map((region) => {
      // Round outward so fractional scaling never leaves a sliver exposed.
      const left = Math.floor(region.x * scaleX);
      const top = Math.floor(region.y * scaleY);
      return {
        x: left,
        y: top,
        width: Math.ceil((region.x + region.width) * scaleX) - left,
        height: Math.ceil((region.y + region.height) * scaleY) - top,
      };
    });
}

export function isCanvasMaskingConfigured(
  masking: CanvasMasking | undefined,
): boolean {
  if (!masking) return false;
  if (!masking.isConfigured) return true;
  try {
    return masking.isConfigured();
  } catch {
    // Suppress snapshot pixels if the dynamic switch itself is unreliable.
    return true;
  }
}

function isValidRegion(region: unknown): region is CanvasMaskRegion {
  if (!region || typeof region !== 'object') return false;
  const { x, y, width, height } = region as CanvasMaskRegion;
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= 0 &&
    height >= 0
  );
}
