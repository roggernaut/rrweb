import type { CanvasMaskRegion, CanvasMasking } from '@rrweb/types';

export const SKIP_FRAME = Symbol('skip-canvas-frame');

export type FrameMaskResult =
  | CanvasMaskRegion[]
  | typeof SKIP_FRAME
  | undefined;

/** Computes and scales application-provided regions before any canvas pixels cross into the encoding worker. */
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

export function getCanvasContentBoxSize(
  canvas: HTMLCanvasElement,
): { width: number; height: number } | null {
  let rect: { width: number; height: number };
  try {
    rect = canvas.getBoundingClientRect();
  } catch {
    return null;
  }
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height))
    return null;

  let style: CSSStyleDeclaration;
  try {
    style = getComputedStyle(canvas);
  } catch {
    return null;
  }
  if (!style) return null;

  const px = (value: string): number => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const width =
    rect.width -
    px(style.paddingLeft) -
    px(style.paddingRight) -
    px(style.borderLeftWidth) -
    px(style.borderRightWidth);
  const height =
    rect.height -
    px(style.paddingTop) -
    px(style.paddingBottom) -
    px(style.borderTopWidth) -
    px(style.borderBottomWidth);

  if (!(width > 0) || !(height > 0)) return null;

  return { width, height };
}

export function resolveFrameDisplaySize(
  masking: CanvasMasking | undefined,
  canvas: HTMLCanvasElement,
): { width: number; height: number } | typeof SKIP_FRAME {
  if (!isCanvasMaskingConfigured(masking)) {
    return {
      width: canvas.clientWidth || canvas.width,
      height: canvas.clientHeight || canvas.height,
    };
  }
  return getCanvasContentBoxSize(canvas) ?? SKIP_FRAME;
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

/** A configured canvas masking provider always forces numeric FPS sampling; only that capture path can redact pixels. */
export function resolveCanvasSampling(
  requestedSampling: number | 'all' | undefined,
  canvasMaskingConfigured: boolean,
): number | 'all' | undefined {
  if (!canvasMaskingConfigured) return requestedSampling;
  if (typeof requestedSampling === 'number') return requestedSampling;
  console.warn(
    '[rrweb] canvasMasking requires FPS canvas capture; forcing sampling.canvas = 4',
  );
  return 4;
}
