import type { eventWithTime } from '@rrweb/types';
import { createTimelineIndex } from './timeline-index';
import { createReplayTimelineScale, type IdleInterval } from './timeline-scale';

export function scaleForTimelineIndex(
  timeline: ReturnType<ReturnType<typeof createTimelineIndex>>,
  inactivePeriodThreshold: number,
  maxIdleShare?: number,
) {
  const { start, end, lastActive, periods } = timeline;
  const intervals: IdleInterval[] = periods.map(([a, b]) => [a - start, b - start]);
  if (end - lastActive > inactivePeriodThreshold) intervals.push([lastActive - start, end - start]);
  return createReplayTimelineScale(end - start, intervals, maxIdleShare);
}

/** Build the player's scale from chronologically ordered rrweb events. Times are recording-relative milliseconds. */
export function createRecordingTimelineScale(
  events: readonly eventWithTime[],
  { inactivePeriodThreshold = 10_000, maxIdleShare = 0.2 } = {},
) {
  return scaleForTimelineIndex(createTimelineIndex()(events, inactivePeriodThreshold), inactivePeriodThreshold, maxIdleShare);
}
