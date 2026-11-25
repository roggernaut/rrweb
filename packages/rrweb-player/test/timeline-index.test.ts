import { describe, expect, it } from 'vitest';
import { EventType, IncrementalSource } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import { createTimelineIndex } from '../src/timeline-index';
import { getActiveCaption } from '../src/annotations';

const caption = (timestamp: number, text: string): eventWithTime => ({
  type: EventType.Annotation,
  timestamp,
  data: { type: 'caption', text },
});
const input = (timestamp: number): eventWithTime => ({
  type: EventType.IncrementalSnapshot,
  timestamp,
  data: { source: IncrementalSource.Input, id: 1, text: '', isChecked: false },
});
const pointerMove = (
  timestamp: number,
  offsets: number[],
  source:
    | IncrementalSource.MouseMove
    | IncrementalSource.TouchMove
    | IncrementalSource.Drag = IncrementalSource.MouseMove,
): eventWithTime => ({
  type: EventType.IncrementalSnapshot,
  timestamp,
  data: {
    source,
    positions: offsets.map((timeOffset) => ({ id: 1, x: 0, y: 0, timeOffset })),
  },
});

describe('timeline indexing cost and ordering', () => {
  it('does not revisit 50,000 existing events when appending a batch', () => {
    let reads = 0;
    const events: eventWithTime[] = Array.from(
      { length: 50000 },
      (_, timestamp) => ({
        get type() {
          reads++;
          return EventType.Load;
        },
        timestamp,
        data: {},
      }),
    );
    const update = createTimelineIndex();
    update(events, 10000);
    reads = 0;
    events.push(caption(60000, 'New caption'));
    update(events, 10000);
    update(events, 10000);
    expect(reads).toBe(0);
  });

  it('preserves captions and inactivity gaps after appends and late insertions', () => {
    const update = createTimelineIndex();
    const events: eventWithTime[] = [caption(1000, 'First')];
    update(events, 1000);
    events.push(caption(3000, 'Second'), caption(3000, 'Last'));
    events.push({
      type: EventType.IncrementalSnapshot,
      timestamp: 6000,
      data: {
        source: IncrementalSource.Input,
        id: 1,
        text: '',
        isChecked: false,
      },
    });
    let index = update(events, 1000);
    expect(index.captions).toEqual([
      { start: 0, action: 'set', text: 'First' },
      { start: 2000, action: 'set', text: 'Second' },
      { start: 2000, action: 'set', text: 'Last' },
    ]);
    expect(index.periods).toEqual([[1000, 6000]]);
    events.splice(0, 0, caption(0, 'Earlier'));
    index = update(events, 1000);
    expect(index.captions).toEqual([
      { start: 0, action: 'set', text: 'Earlier' },
      { start: 1000, action: 'set', text: 'First' },
      { start: 3000, action: 'set', text: 'Second' },
      { start: 3000, action: 'set', text: 'Last' },
    ]);
    expect(index.periods).toEqual([[0, 6000]]);
    expect(getActiveCaption(index.captions, 3000)?.text).toBe('Last');
  });

  it('splits an existing gap when an appended mouse sample played before earlier events', () => {
    const update = createTimelineIndex();
    const events = [caption(1000, 'Start'), input(13000), input(36000)];
    expect(update(events, 10000).periods).toEqual([
      [1000, 13000],
      [13000, 36000],
    ]);

    events.push(pointerMove(40000, [-33000, -16000]));
    const index = update(events, 10000);
    expect(index.periods).toEqual([
      [13000, 24000],
      [24000, 36000],
    ]);
    expect(index.lastActive).toBe(36000);
  });

  it.each([
    IncrementalSource.MouseMove,
    IncrementalSource.TouchMove,
    IncrementalSource.Drag,
  ])(
    'uses all samples of pointer source %i, including the last active time',
    (source) => {
      const update = createTimelineIndex();
      const events = [
        caption(1000, 'Start'),
        pointerMove(23000, [-11000, -5000, -1000], source),
      ];
      const index = update(events, 10000);
      expect(index.periods).toEqual([[1000, 12000]]);
      expect(index.lastActive).toBe(22000);

      events.push(input(29000));
      expect(update(events, 10000).periods).toEqual([[1000, 12000]]);
    },
  );

  it('uses logarithmic caption lookup even near the beginning', () => {
    let reads = 0;
    const captions = Array.from({ length: 100000 }, (_, start) => ({
      get start() {
        reads++;
        return start;
      },
      action: 'set' as const,
      text: String(start),
    }));
    expect(getActiveCaption(captions, 1)?.text).toBe('1');
    expect(reads).toBeLessThan(20);
  });
});
