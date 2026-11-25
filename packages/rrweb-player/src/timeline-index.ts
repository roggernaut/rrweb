import { EventType, IncrementalSource } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import { parseAnnotation } from './annotations';
import type { Caption } from './annotations';
import { isUserInteraction } from './utils';

/** Consume appended events once. Late insertions rebuild to preserve replay order. */
export function createTimelineIndex() {
  let count = 0;
  let lastEvent: eventWithTime | undefined;
  let threshold: number | undefined;
  let state = empty();

  function empty(): {
    start: number;
    end: number;
    captions: Caption[];
    markers: { timestamp: number; tag?: string; text?: string }[];
    periods: [number, number][];
    hasCaptions: boolean;
    lastActive: number;
  } {
    return {
      start: 0,
      end: 0,
      captions: [],
      markers: [],
      periods: [],
      hasCaptions: false,
      lastActive: 0,
    };
  }

  function addActivity(time: number, inactiveThreshold: number) {
    const { periods, lastActive } = state;
    if (time > lastActive) {
      if (time - lastActive > inactiveThreshold) {
        periods.push([lastActive, time]);
      }
      state.lastActive = time;
      return;
    }

    // A pointer batch can arrive after events that played later than its
    // samples. Only a sample inside an existing idle period can change it.
    let low = 0;
    let high = periods.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (periods[mid][1] <= time) low = mid + 1;
      else high = mid;
    }
    const period = periods[low];
    if (!period || time <= period[0]) return;

    const [start, end] = period;
    const remaining: [number, number][] = [];
    if (time - start > inactiveThreshold) remaining.push([start, time]);
    if (end - time > inactiveThreshold) remaining.push([time, end]);
    periods.splice(low, 1, ...remaining);
  }

  return (events: readonly eventWithTime[], inactiveThreshold: number) => {
    if (
      threshold !== inactiveThreshold ||
      events.length < count ||
      (count > 0 && events[count - 1] !== lastEvent)
    ) {
      count = 0;
      state = empty();
    }
    threshold = inactiveThreshold;
    if (!count) {
      state.start = events[0]?.timestamp ?? 0;
      state.lastActive = state.start;
    }
    for (; count < events.length; count++) {
      const event = events[count];
      if (event.type === EventType.Annotation) {
        const annotation = parseAnnotation(event.data);
        if (annotation?.type === 'caption') {
          const start = event.timestamp - state.start;
          state.captions.push(
            annotation.text
              ? { start, action: 'set', text: annotation.text }
              : { start, action: 'clear' },
          );
          if (annotation.text) state.hasCaptions = true;
        } else if (annotation?.type === 'timelineMarker') {
          state.markers.push({
            timestamp: event.timestamp,
            text: annotation.text,
          });
        }
      } else if (event.type === EventType.Custom) {
        state.markers.push({ timestamp: event.timestamp, tag: event.data.tag });
      }
      if (
        event.type === EventType.IncrementalSnapshot &&
        (event.data.source === IncrementalSource.MouseMove ||
          event.data.source === IncrementalSource.TouchMove ||
          event.data.source === IncrementalSource.Drag) &&
        event.data.positions?.length
      ) {
        for (const { timeOffset } of event.data.positions) {
          const offset = Number.isFinite(timeOffset)
            ? Math.min(0, timeOffset)
            : 0;
          addActivity(event.timestamp + offset, inactiveThreshold);
        }
      } else if (isUserInteraction(event)) {
        addActivity(event.timestamp, inactiveThreshold);
      }
    }
    lastEvent = events[count - 1];
    state.end = lastEvent?.timestamp ?? state.start;
    return state;
  };
}
