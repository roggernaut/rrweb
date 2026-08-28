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

/**
 * The canvas backing store maps onto the content box, not the border box
 * `clientWidth` reports (which includes padding and would skew the scale
 * factor). Returns `null`, never a fallback size, so callers fail closed.
 */
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

/**
 * The display box a frame's mask regions are scaled against. Gated on
 * `isCanvasMaskingConfigured`, not mere presence: an unconfigured provider
 * masks nothing, so skip the per-frame layout-flush cost of measuring it.
 * When masking is in force, an unmeasurable box fails closed to `SKIP_FRAME`
 * rather than guessing a scale that misplaces the regions.
 */
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

/**
 * Only the FPS/OffscreenCanvas capture path can redact pixels; the mutation
 * command-stream path replays raw canvas calls verbatim. So a configured
 * canvas masking provider always forces numeric FPS sampling -- otherwise
 * masking would be silently bypassed. See guide.md's "Canvas masking".
 */
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
