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
 * The canvas backing store maps onto the element's content box (the CSS
 * width/height it is drawn at), not its border box. `clientWidth` includes
 * padding, so a padded canvas would otherwise skew the scale factor used to
 * translate application-provided mask regions into backing-store pixels.
 *
 * Returns `null` (never a fallback size) when the content box cannot be
 * measured or has zero area, so callers fail closed instead of silently
 * reinterpreting CSS-pixel regions as backing-store pixels.
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
 * Canvas privacy masking only redacts pixels on the FPS/OffscreenCanvas
 * capture path (`sampling.canvas` as a number): that path renders full
 * frames through `computeFrameMaskRegions` before they ever reach the
 * encoding worker. The mutation-mode command stream (`sampling.canvas` as
 * `'all'` or `undefined`) replays raw canvas API calls verbatim and has no
 * way to redact anything.
 *
 * If canvas masking is configured but sampling stays in mutation mode, the
 * masking is silently bypassed. To make that impossible, canvas masking
 * being configured always forces numeric FPS sampling.
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
