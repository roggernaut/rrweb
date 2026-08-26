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
