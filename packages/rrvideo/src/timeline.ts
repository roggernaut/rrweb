import { EventType, type eventWithTime } from '@rrweb/types';
import type { ViewportSize } from './types';

/** Round to an even pixel so libx264 yuv420p encoding is valid. */
export function evenDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded + (rounded % 2);
}

export function getMaxViewport(events: eventWithTime[]): ViewportSize {
  let maxWidth = 0;
  let maxHeight = 0;
  events.forEach((event) => {
    if (event.type !== EventType.Meta) return;
    if (event.data.width > maxWidth) maxWidth = event.data.width;
    if (event.data.height > maxHeight) maxHeight = event.data.height;
  });
  return {
    width: maxWidth,
    height: maxHeight,
  };
}

export function scaleViewport(
  viewport: ViewportSize,
  ratio: number,
): ViewportSize {
  return {
    width: evenDimension(viewport.width * ratio),
    height: evenDimension(viewport.height * ratio),
  };
}

export function getSessionDurationMs(events: eventWithTime[]): number {
  if (events.length === 0) return 0;
  return events[events.length - 1].timestamp - events[0].timestamp;
}

/**
 * Number of output frames for a session played at `speed`.
 * `speed` 2 or 4 shortens the file rather than dropping the output fps.
 */
export function estimateFrameCount(
  durationMs: number,
  fps: number,
  speed: number,
): number {
  const playbackMs = durationMs / Math.max(speed, 0.001);
  return Math.max(1, Math.round((playbackMs * fps) / 1000));
}
