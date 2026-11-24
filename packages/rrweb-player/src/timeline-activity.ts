import type { ReplayTimelineScale } from './timeline-scale';

export type ActivityEvent = { type: number; timestamp: number; data?: unknown };
/** What happened in one second of the recording. The four measures have
 * different units and are never added together. */
export type ActivityBucket = {
  /** Number of clicks. */
  clicks: number;
  /** Number of input events. Their values are never read. */
  inputs: number;
  /** Scroll distance in recorded pixels, summed over every scroller. */
  scroll: number;
  /** Pointer travel in recorded pixels: mouse moves, touch moves and drags. */
  mouse: number;
};
/** The graph reads `total`, `spans` and both mapping functions. */
export type ActivityScale = ReplayTimelineScale;

// rrweb wire values: IncrementalSnapshot is event type 3; its sources are
// MouseMove 1, MouseInteraction 2, Scroll 3, Input 5, TouchMove 6, Drag 12;
// a MouseInteraction of type 2 is a click.
const isClick = (event: ActivityEvent) => {
  const data = object(event.data);
  return event.type === 3 && data.source === 2 && data.type === 2;
};

/** Click times in milliseconds from the first event. The graph marks each
 * click at its exact time. A bucket's click count is not drawn; it only
 * tells the graph that a recording with nothing but clicks has activity. */
export function replayClickTimes(events: readonly ActivityEvent[]) {
  const start = events[0]?.timestamp ?? 0;
  return events.filter(isClick).map((event) => event.timestamp - start);
}

/** Pointer samples further apart than this are separate movements; the
 * distance between them is not counted as travel. */
const POINTER_GAP_MS = 10_000;
/** The drawing has this many intervals, whatever the recording's length. */
const SAMPLE_INTERVALS = 600;
/** Clicks closer together than this fraction of the timeline's width share
 * one mark: about the width of a mark on a 1000 px timeline. */
const CLICK_MERGE_FRACTION = 0.008;
/** Half-width of the smoothing around each one-second bucket, in seconds. */
const BUCKET_RADIUS_S = 0.75;
/** Activity eases to zero over this fraction of the width beside an idle gap. */
const IDLE_EDGE_TAPER = 0.018;
const empty = (): ActivityBucket => ({
  clicks: 0,
  inputs: 0,
  scroll: 0,
  mouse: 0,
});
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Sparse, one-second buckets. Input text and checked values are never read. */
export function bucketReplayActivity(
  events: readonly ActivityEvent[],
  duration: number,
) {
  const buckets = new Map<number, ActivityBucket>();
  const start = events[0]?.timestamp ?? 0;
  const scroll = new Map<number, { x: number; y: number }>();
  const moves: Array<{ time: number; x: number; y: number; epoch: number }> =
    [];
  let epoch = 0;
  function bucket(time: number) {
    if (!finite(time) || time < 0 || time > duration) return null;
    const second = Math.floor(time / 1000);
    let value = buckets.get(second);
    if (!value) {
      value = empty();
      buckets.set(second, value);
    }
    return value;
  }
  for (const event of events) {
    const data = object(event.data);
    if (event.type === 2) {
      epoch++;
      scroll.clear();
      const node = object(data.node),
        offset = object(data.initialOffset);
      if (finite(node.id) && finite(offset.left) && finite(offset.top))
        scroll.set(node.id, { x: offset.left, y: offset.top });
    }
    if (event.type !== 3) continue;
    const time = event.timestamp - start;
    if (data.source === 1 || data.source === 6 || data.source === 12) {
      if (!Array.isArray(data.positions)) continue;
      for (const raw of data.positions) {
        const point = object(raw);
        if (finite(point.x) && finite(point.y) && finite(point.timeOffset))
          moves.push({
            time: time + point.timeOffset,
            x: point.x,
            y: point.y,
            epoch,
          });
      }
      continue;
    }
    const value = bucket(time);
    if (!value) continue;
    if (isClick(event)) value.clicks++;
    if (data.source === 5) value.inputs++;
    if (
      data.source === 3 &&
      finite(data.id) &&
      finite(data.x) &&
      finite(data.y)
    ) {
      const previous = scroll.get(data.id);
      if (previous)
        value.scroll += Math.hypot(data.x - previous.x, data.y - previous.y);
      // No assumed origin for a nested scroller whose first offset is unknown.
      scroll.set(data.id, { x: data.x, y: data.y });
    }
  }
  moves.sort((a, b) => a.time - b.time);
  let previous: (typeof moves)[number] | undefined;
  for (const point of moves) {
    const value = bucket(point.time);
    if (!value) continue;
    if (
      previous &&
      previous.epoch === point.epoch &&
      point.time - previous.time <= POINTER_GAP_MS
    )
      value.mouse += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return buckets;
}

/** The stacked bands, bottom first. Clicks are moments, not amounts, and are
 * drawn as marks instead (see `clickMarks`). */
export const ACTIVITY_LAYERS = ['mouse', 'scroll', 'inputs'] as const;

/** Where to mark clicks on the timeline: `from` and `to` are fractions of its
 * width, equal for a single click. Clicks that would touch share one mark
 * that spans them, so a burst reads as one longer mark. Each click is placed
 * at its exact time, also at the edge of a compressed idle gap. */
export function clickMarks(
  clickTimes: readonly number[],
  scale: ActivityScale,
) {
  const positions = clickTimes
    .filter((time) => finite(time) && time >= 0 && time <= scale.total)
    .map(scale.timeToPosition)
    .sort((a, b) => a - b);
  const marks: { from: number; to: number; count: number }[] = [];
  for (const position of positions) {
    const last = marks[marks.length - 1];
    if (last && position - last.to < CLICK_MERGE_FRACTION) {
      last.to = position;
      last.count++;
    } else marks.push({ from: position, to: position, count: 1 });
  }
  return marks;
}

/** A fixed-size drawing of the stacked bands, independent of recording
 * length.
 *
 * Each sample's `layers` follow the order of ACTIVITY_LAYERS, bottom of the
 * stack first. Every layer is scaled to its own highest value and gets an
 * equal share of the height, so a full-height stack means all three peak at
 * once. Heights compare a layer with itself over time; they do not compare
 * layers with each other or one recording with another. */
export function activitySamples(
  buckets: Map<number, ActivityBucket>,
  scale: ActivityScale,
) {
  const positions = Array.from(
    { length: SAMPLE_INTERVALS + 1 },
    (_, index) => index / SAMPLE_INTERVALS,
  );
  // When a display interval spans several seconds, collect every occupied
  // bucket in it. Sampling only at the grid point loses isolated bursts.
  const coarse = new Map<
    number,
    { position: number; values: ActivityBucket }
  >();
  const ordered = [...buckets.entries()].sort(([a], [b]) => a - b);
  let first = 0;
  for (const span of scale.spans) {
    if (
      span.idle ||
      span.end - span.start <=
        (span.right - span.left) * SAMPLE_INTERVALS * 1000
    )
      continue;
    while (
      first < ordered.length &&
      (ordered[first][0] + 1) * 1000 <= span.start
    )
      first++;
    for (
      let i = first;
      i < ordered.length && ordered[i][0] * 1000 < span.end;
      i++
    ) {
      const [second, bucket] = ordered[i];
      const start = Math.max(span.start, second * 1000);
      const end = Math.min(span.end, (second + 1) * 1000);
      const position = scale.timeToPosition((start + end) / 2);
      const index = Math.round(position * SAMPLE_INTERVALS);
      const bin = coarse.get(index) ?? { position, values: empty() };
      for (const key of ACTIVITY_LAYERS)
        bin.values[key] += (bucket[key] * (end - start)) / 1000;
      coarse.set(index, bin);
    }
  }
  const samples = positions.map((position, index) => {
    const bin = coarse.get(index);
    if (bin)
      return {
        position: bin.position,
        time: scale.positionToTime(bin.position),
        values: bin.values,
      };
    const time = scale.positionToTime(position);
    const span = scale.spans.find(
      (part) => time >= part.start && time < part.end,
    );
    const values = empty();
    if (span && !span.idle) {
      const second = Math.floor(time / 1000);
      const radius = BUCKET_RADIUS_S;
      for (let offset = -1; offset <= 1; offset++) {
        const at = (second + offset) * 1000;
        // Keep a bucket that overlaps the active span, such as the second
        // in which activity resumes after a gap.
        if (at + 1000 <= span.start || at >= span.end) continue;
        const bucket = buckets.get(second + offset);
        if (!bucket) continue;
        // A continuous kernel around each bucket's centre avoids stair steps
        // at second boundaries. The buckets themselves are left unchanged.
        const distance = Math.abs((time - at - 500) / 1000);
        if (distance >= radius) continue;
        const weight =
          (1 + Math.cos((Math.PI * distance) / radius)) / (2 * radius);
        for (const key of ACTIVITY_LAYERS) values[key] += bucket[key] * weight;
      }
      // Ease to the baseline on the active side of an idle boundary. Use
      // display distance so compressed gaps don't turn this into a cliff.
      const width = Math.min(IDLE_EDGE_TAPER, (span.right - span.left) / 3);
      const edge = Math.min(
        1,
        span.start > 0 ? (position - span.left) / width : 1,
        span.end < scale.total ? (span.right - position) / width : 1,
      );
      const taper = edge * edge * (3 - 2 * edge);
      for (const key of ACTIVITY_LAYERS) values[key] *= taper;
    }
    return { position, time, values };
  });
  const maxima = empty();
  for (const sample of samples)
    for (const key of ACTIVITY_LAYERS)
      maxima[key] = Math.max(maxima[key], sample.values[key]);
  return samples.map(({ position, time, values }) => ({
    position,
    time,
    layers: ACTIVITY_LAYERS.map((key) =>
      maxima[key] ? values[key] / maxima[key] / ACTIVITY_LAYERS.length : 0,
    ),
  }));
}
