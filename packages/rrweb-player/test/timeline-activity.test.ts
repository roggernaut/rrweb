import { describe, expect, it } from 'vitest';
import { createReplayTimelineScale } from '../src/timeline-scale';
import {
  activitySamples,
  bucketReplayActivity,
  clickMarks,
  replayClickTimes,
  type ActivityEvent,
} from '../src/timeline-activity';

const event = (time: number, data: unknown): ActivityEvent => ({
  type: 3,
  timestamp: 1000 + time,
  data,
});
const meta: ActivityEvent = { type: 4, timestamp: 1000 };
describe('timeline activity', () => {
  it('counts clicks and input events without reading their content', () => {
    const input = {
      source: 5,
      get text() {
        throw new Error('Input content must not be read');
      },
      get isChecked() {
        throw new Error('Input values must not be read');
      },
    };
    const buckets = bucketReplayActivity(
      [
        meta,
        event(1100, { source: 2, type: 0 }), // mousedown is not a second click
        event(1200, { source: 2, type: 2 }),
        event(1500, input),
        event(1600, input),
        event(2000, { source: 0 }),
      ],
      3000,
    );
    expect(buckets.get(1)).toEqual({
      clicks: 1,
      inputs: 2,
      mouse: 0,
      scroll: 0,
    });
    expect(buckets.get(2)?.clicks).toBe(0);
  });
  it('places batched movement at its sample time and does not bridge idle gaps or snapshots', () => {
    const buckets = bucketReplayActivity(
      [
        meta,
        event(2200, {
          source: 1,
          positions: [
            { x: 0, y: 0, timeOffset: -1400 },
            { x: 3, y: 4, timeOffset: -900 },
            { x: 6, y: 8, timeOffset: 0 },
          ],
        }),
        event(20000, {
          source: 1,
          positions: [{ x: 600, y: 800, timeOffset: 0 }],
        }),
        { type: 2, timestamp: 22000, data: {} },
        event(22000, { source: 1, positions: [{ x: 0, y: 0, timeOffset: 0 }] }),
      ],
      30000,
    );
    expect(buckets.get(1)?.mouse).toBe(5);
    expect(buckets.get(2)?.mouse).toBe(5);
    expect(buckets.get(20)?.mouse).toBe(0);
    expect(buckets.get(22)?.mouse).toBe(0);
  });
  it('uses per-scroller offsets and sums both directions, without an invented first origin', () => {
    const buckets = bucketReplayActivity(
      [
        meta,
        {
          type: 2,
          timestamp: 1000,
          data: { node: { id: 1 }, initialOffset: { left: 0, top: 0 } },
        },
        event(1000, { source: 3, id: 1, x: 0, y: 100 }),
        event(1200, { source: 3, id: 2, x: 0, y: 500 }),
        event(1400, { source: 3, id: 1, x: 0, y: 20 }),
        event(1600, { source: 3, id: 2, x: 0, y: 530 }),
      ],
      3000,
    );
    expect(buckets.get(1)?.scroll).toBe(210);
  });
  it('normalizes unlike units independently and leaves compressed idle gaps empty', () => {
    const scale = createReplayTimelineScale(30000, [[10000, 20000]]);
    const samples = activitySamples(
      new Map([[5, { clicks: 1, inputs: 1, scroll: 400, mouse: 933 }]]),
      scale,
    );
    const peak = samples.reduce((best, sample) =>
      sample.layers[0] > best.layers[0] ? sample : best,
    );
    // Three stacked bands, a third of the height each; clicks are not one.
    expect(peak.layers).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(
      samples
        .filter((sample) => sample.time > 10000 && sample.time < 20000)
        .every((sample) => sample.layers.every((value) => value === 0)),
    ).toBe(true);
    const shoulder = samples.find(
      (sample) => sample.time >= 5000 && sample.time < 5250,
    )!;
    expect(shoulder.layers[2]).toBeGreaterThan(0);
    expect(shoulder.layers[2]).toBeLessThan(1 / 3);
    const withinSecond = samples.filter(
      (sample) => sample.time >= 5000 && sample.time < 5250,
    );
    expect(
      new Set(withinSecond.map((sample) => sample.layers[2])).size,
    ).toBeGreaterThan(1);
    expect(
      samples
        .filter((sample) => sample.time < 4750)
        .every((sample) => sample.layers[2] === 0),
    ).toBe(true);
  });
  it('tapers activity to zero at both sides of compressed inactivity', () => {
    const scale = createReplayTimelineScale(30000, [[10000, 20000]]);
    const samples = activitySamples(
      new Map(
        [9, 20].map((second) => [
          second,
          { clicks: 0, inputs: 1, scroll: 0, mouse: 0 },
        ]),
      ),
      scale,
    );
    const before = samples.filter((sample) => sample.time < 10000).at(-1)!;
    const after = samples.find((sample) => sample.time > 20000)!;
    expect(before.layers[2]).toBeLessThan(0.01);
    expect(after.layers[2]).toBeLessThan(0.01);
    expect(samples.some((sample) => sample.layers[2] === 1 / 3)).toBe(true);
  });
  it('keeps activity in the second in which it resumes after a gap', () => {
    // Activity resumes at 12.345 s, partway through the 12 s bucket.
    const scale = createReplayTimelineScale(30000, [[2000, 12345]]);
    const samples = activitySamples(
      new Map([[12, { clicks: 0, inputs: 1, scroll: 0, mouse: 0 }]]),
      scale,
    );
    expect(
      samples.some(
        (sample) =>
          sample.time > 12345 && sample.time < 13000 && sample.layers[2] > 0,
      ),
    ).toBe(true);
  });
  it('keeps a recording with only clicks out of the stacked bands', () => {
    const scale = createReplayTimelineScale(30000, []);
    const buckets = bucketReplayActivity(
      [meta, event(5000, { source: 2, type: 2 })],
      scale.total,
    );
    expect(buckets.get(5)?.clicks).toBe(1);
    expect(
      activitySamples(buckets, scale).every((sample) =>
        sample.layers.every((value) => value === 0),
      ),
    ).toBe(true);
  });
});

describe('click marks', () => {
  const scale = createReplayTimelineScale(81080, [
    [1725, 44437],
    [52648, 69754],
  ]);
  it.each([1725, 44437, 46924, 52648, 69754, 70966])(
    'marks a click at %sms at its exact position, including compressed idle boundaries',
    (time) => {
      expect(clickMarks([time], scale)).toEqual([
        {
          from: scale.timeToPosition(time),
          to: scale.timeToPosition(time),
          count: 1,
        },
      ]);
    },
  );
  it('reads click times from the events, whatever else was recorded', () => {
    expect(
      replayClickTimes([
        meta,
        event(1200, { source: 2, type: 2 }),
        // A mouse-down and an input are not clicks.
        event(1300, { source: 2, type: 1 }),
        event(1400, { source: 5 }),
        event(9000, { source: 2, type: 2 }),
      ]),
    ).toEqual([1200, 9000]);
  });
  it('merges a burst into one mark that spans it and keeps distant clicks apart', () => {
    const linear = createReplayTimelineScale(100000, []);
    // 300 ms apart is 0.3% of the width, inside the 0.8% merge distance;
    // each next click is measured from the previous one, so a chain merges.
    const marks = clickMarks([50600, 10000, 50000, 50300, 90000], linear);
    expect(marks).toEqual([
      { from: 0.1, to: 0.1, count: 1 },
      { from: 0.5, to: 0.506, count: 3 },
      { from: 0.9, to: 0.9, count: 1 },
    ]);
    // The distance is measured from the last click of the burst, so a
    // steady run longer than the merge distance is still one mark.
    expect(clickMarks([50000, 50600, 51200], linear)).toEqual([
      { from: 0.5, to: 0.512, count: 3 },
    ]);
    // 1% apart stays two marks.
    expect(clickMarks([50000, 51000], linear)).toHaveLength(2);
  });
  it('drops clicks outside the recording and returns nothing for none', () => {
    const linear = createReplayTimelineScale(10000, []);
    expect(clickMarks([-1, 10001, Number.NaN], linear)).toEqual([]);
    expect(clickMarks([], linear)).toEqual([]);
  });
});

describe('sampling bounds', () => {
  it('draws a one-second input burst between samples in a 24-hour session', () => {
    const samples = activitySamples(
      new Map([[70, { clicks: 0, inputs: 1, mouse: 0, scroll: 0 }]]),
      createReplayTimelineScale(86_400_000, []),
    );
    expect(samples).toHaveLength(601);
    expect(samples.find((s) => s.layers[2] > 0)?.time).toBeCloseTo(70_500);
  });
  it('keeps long and empty recordings bounded', () => {
    for (const total of [0, 24 * 60 * 60 * 1000]) {
      const samples = activitySamples(
        new Map(),
        createReplayTimelineScale(total, []),
      );
      expect(samples).toHaveLength(601);
      expect(
        samples.every((sample) => sample.layers.every((value) => value === 0)),
      ).toBe(true);
    }
  });
});
