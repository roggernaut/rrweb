import {
  evenDimension,
  estimateFrameCount,
  getMaxViewport,
  getSessionDurationMs,
} from '../src/timeline';
import { EventType, type eventWithTime } from '@rrweb/types';

describe('timeline helpers', () => {
  it('rounds dimensions up to even values for yuv420p', () => {
    expect(evenDimension(1920)).toBe(1920);
    expect(evenDimension(1080)).toBe(1080);
    expect(evenDimension(1001)).toBe(1002);
    expect(evenDimension(1)).toBe(2);
  });

  it('counts frames from session duration, fps, and playback speed', () => {
    expect(estimateFrameCount(1000, 60, 1)).toBe(60);
    expect(estimateFrameCount(1000, 60, 2)).toBe(30);
    expect(estimateFrameCount(1000, 60, 4)).toBe(15);
    expect(estimateFrameCount(300, 60, 1)).toBe(18);
  });

  it('reads duration and viewport from events', () => {
    const events = [
      {
        type: EventType.Meta,
        data: { href: 'http://localhost', width: 1280, height: 720 },
        timestamp: 1000,
      },
      {
        type: EventType.IncrementalSnapshot,
        data: { source: 0 },
        timestamp: 2500,
      },
    ] as unknown as eventWithTime[];
    expect(getSessionDurationMs(events)).toBe(1500);
    expect(getMaxViewport(events)).toEqual({ width: 1280, height: 720 });
  });
});
