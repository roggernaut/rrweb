import { describe, expect, it } from 'vitest';
import { createRecordingTimelineScale } from 'rrweb-player/timeline';
import { EventType, IncrementalSource } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';

describe('the public timeline entry point', () => {
  it('maps a trailing idle interval in both directions', () => {
    const events = [
      { type: EventType.DomContentLoaded, timestamp: 100, data: {} },
      { type: EventType.IncrementalSnapshot, timestamp: 1100, data: { source: IncrementalSource.Input, id: 1, text: '', isChecked: false } },
      { type: EventType.Load, timestamp: 30100, data: {} },
    ] satisfies eventWithTime[];
    const scale = createRecordingTimelineScale(events);
    expect(scale.timeToPosition(1000)).toBeCloseTo(0.8);
    expect(scale.positionToTime(0.8)).toBeCloseTo(1000);
  });
});
