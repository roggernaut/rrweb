import type { eventWithTime, serializedNodeWithId } from '@rrweb/types';
import type { CheckContext, CheckDefinition } from '../harness.ts';
import type { AttemptResult, PerfSample, Tier } from '../../types.ts';

/** An element or rule count times the run's scale, never below 1. */
function scaled(ctx: CheckContext, count: number): number {
  return Math.max(1, Math.round(count * ctx.options.scale));
}

/** Lets the browser finish style and layout, so the sample measures rrweb. */
async function settle(ctx: CheckContext): Promise<void> {
  await ctx.nextFrame();
  await ctx.nextFrame();
}

/** Replaces the body with `count` `div>span` text nodes. */
function fillBody(count: number): void {
  const rows: string[] = [];
  for (let i = 0; i < count; i++) rows.push(`<div><span>row ${i}</span></div>`);
  document.body.innerHTML = rows.join('');
}

/** Resolves in a new task; unlike setTimeout(0), it is never clamped. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

const hasFullSnapshot = (events: eventWithTime[]) =>
  events.some((e) => e.type === 2 /* FullSnapshot */);

function sampleOf(
  measured: { durationMs: number; maxBlockMs: number },
  heapDeltaBytes?: number,
): AttemptResult {
  const sample: PerfSample = {
    durationMs: measured.durationMs,
    maxBlockMs: measured.maxBlockMs,
  };
  if (heapDeltaBytes !== undefined) sample.heapDeltaBytes = heapDeltaBytes;
  return { ok: true, sample };
}

/** How many nodes the FullSnapshot serialized. */
function snapshotNodeCount(events: eventWithTime[]): number {
  const full = events.find((e) => e.type === 2 /* FullSnapshot */);
  if (!full || full.type !== 2) return 0;
  const stack: serializedNodeWithId[] = [full.data.node];
  let count = 0;
  for (let node = stack.pop(); node; node = stack.pop()) {
    count++;
    if ('childNodes' in node) stack.push(...node.childNodes);
  }
  return count;
}

/**
 * Measures the `record()` call, which takes the full snapshot. `done` names
 * what is wrong when the snapshot skipped the work: a recorder doing less
 * would otherwise simply look faster.
 */
async function measureSnapshot(
  ctx: CheckContext,
  done: (events: eventWithTime[]) => string | undefined,
): Promise<AttemptResult> {
  await settle(ctx);
  const measured = await ctx.measure(() => ctx.record());
  const events = await measured.value.stop();
  if (!hasFullSnapshot(events)) {
    return { ok: false, message: 'no full snapshot' };
  }
  const message = done(events);
  if (message !== undefined) return { ok: false, message };
  return sampleOf(measured);
}

const largeStylesheet: CheckDefinition = {
  id: 'perf-large-stylesheet',
  kind: 'performance',
  tier: 'focused',
  compare: ['durationMs'],
  async run(ctx) {
    // About 100 bytes a rule, so 20,000 rules make about 2 MB.
    const rules: string[] = [];
    const ruleCount = scaled(ctx, 20_000);
    for (let i = 0, n = ruleCount; i < n; i++) {
      const color = (i % 4096).toString(16).padStart(3, '0');
      rules.push(
        `.r${i} > .c${i}:hover { color: #${color}; margin: 1px 2px 3px 4px; border: 1px solid #000; padding: 0 1px; }`,
      );
    }
    const style = document.createElement('style');
    style.textContent = rules.join('\n');
    document.head.appendChild(style);
    document.body.innerHTML = '<div class="r0"><span class="c0">x</span></div>';
    return measureSnapshot(ctx, (events) => {
      const json = JSON.stringify(events.filter((e) => e.type === 2));
      const last = `.r${ruleCount - 1} > .c${ruleCount - 1}`;
      return json.includes('.r0 > .c0') && json.includes(last)
        ? undefined
        : 'the snapshot does not hold the whole stylesheet';
    });
  },
};

function snapshotScenario(
  id: string,
  count: number,
  tier: Tier,
  ceilingMs?: number,
): CheckDefinition {
  return {
    id,
    kind: 'performance',
    tier,
    compare: ['durationMs'],
    ...(ceilingMs === undefined ? {} : { ceilingMs }),
    async run(ctx) {
      const rows = scaled(ctx, count);
      fillBody(rows);
      return measureSnapshot(ctx, (events) => {
        const nodes = snapshotNodeCount(events);
        // Each row is a div, a span and a text node.
        return nodes < rows * 3
          ? `the snapshot holds ${nodes} nodes, fewer than the ${
              rows * 3
            } in the page`
          : undefined;
      });
    },
  };
}

const mutationBurst: CheckDefinition = {
  id: 'perf-mutation-burst-10k',
  kind: 'performance',
  tier: 'focused',
  compare: ['durationMs', 'maxBlockMs'],
  async run(ctx) {
    const count = scaled(ctx, 10_000);
    const container = document.createElement('div');
    document.body.appendChild(container);
    // rrweb emits the Mutation event from its MutationObserver callback, so
    // that event marks the end of the recorder's processing.
    let emitted: () => void = () => undefined;
    const mutationEmitted = new Promise<void>((resolve) => (emitted = resolve));
    const recording = ctx.record({
      emit(event) {
        if (
          event.type === 3 /* IncrementalSnapshot */ &&
          event.data.source === 0 /* Mutation */ &&
          event.data.adds.length > 0
        ) {
          emitted();
        }
      },
    });
    await settle(ctx);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measured = await ctx.measure(async () => {
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const div = document.createElement('div');
        div.textContent = `added ${i}`;
        fragment.appendChild(div);
      }
      container.appendChild(fragment);
      return Promise.race([
        mutationEmitted.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 10_000);
        }),
      ]);
    });
    clearTimeout(timer);
    const events = await recording.stop();
    if (!measured.value) {
      return { ok: false, message: 'no Mutation event within 10000 ms' };
    }
    let added = 0;
    for (const e of events) {
      if (e.type !== 3 /* IncrementalSnapshot */ || e.data.source !== 0) {
        continue; // not a Mutation
      }
      for (const { node } of e.data.adds) {
        if (node.type === 2 && node.tagName === 'div') added++;
      }
    }
    if (added !== count) {
      return {
        ok: false,
        message: `Mutation events add ${added} of the ${count} elements`,
      };
    }
    return sampleOf(measured);
  },
};

const sampledCanvases: CheckDefinition = {
  id: 'perf-sampled-canvases',
  kind: 'performance',
  tier: 'focused',
  compare: ['maxBlockMs'],
  // rrweb starts its snapshot worker from a blob: URL, which WebKit blocks
  // on the null origin of a page loaded with setContent.
  needsHttp: true,
  async run(ctx) {
    const canvases: HTMLCanvasElement[] = [];
    const canvasCount = scaled(ctx, 4);
    for (let i = 0, n = canvasCount; i < n; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 150;
      document.body.appendChild(canvas);
      canvases.push(canvas);
    }
    const contexts = canvases.map((canvas) => canvas.getContext('2d')!);
    let drawing = true;
    let frame = 0;
    const draw = () => {
      if (!drawing) return;
      frame++;
      contexts.forEach((context, i) => {
        context.fillStyle = `hsl(${(frame * 7 + i * 90) % 360} 80% 50%)`;
        context.fillRect(0, 0, 300, 150);
        context.fillStyle = '#fff';
        context.fillRect((frame * 5) % 280, 60, 20, 30);
      });
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    await settle(ctx);
    let recording: ReturnType<CheckContext['record']> | undefined;
    const measured = await ctx.measure(async () => {
      recording = ctx.record({
        recordCanvas: true,
        sampling: { canvas: 15 },
      });
      await ctx.sleep(3000);
    });
    drawing = false;
    const events = await recording!.stop();
    const sampled = new Set(
      events.flatMap((e) =>
        e.type === 3 /* IncrementalSnapshot */ &&
        e.data.source === 9 /* CanvasMutation */
          ? [e.data.id]
          : [],
      ),
    );
    if (sampled.size < canvasCount) {
      return {
        ok: false,
        message: `CanvasMutation events for ${sampled.size} of the ${canvasCount} canvases in 3000 ms`,
      };
    }
    return sampleOf(measured);
  },
};

const cycles = 20;

const recordStopCycles: CheckDefinition = {
  id: 'perf-record-stop-cycles',
  kind: 'performance',
  tier: 'focused',
  compare: ['durationMs', 'heapDeltaBytes'],
  async run(ctx) {
    fillBody(scaled(ctx, 2000));
    await settle(ctx);
    // gc() exists only when the browser was launched with the heap flags
    // (chromiumHeapArgs), which also make performance.memory precise. Without
    // them Chromium reports rounded values that look like a measured 0, so
    // the heap is read only when gc() is there.
    const gc = (window as { gc?: () => void }).gc;
    const heap = () => {
      if (typeof gc !== 'function') return undefined;
      gc();
      return ctx.heapBytes();
    };
    // One unmeasured cycle first, so the baseline already holds the larger
    // part of rrweb's one-time cost and the delta leans on per-cycle growth.
    const warmUp = ctx.rrweb.record({ emit: () => undefined });
    if (!warmUp) throw new Error('rrweb.record did not start');
    warmUp();
    await settle(ctx);
    const before = heap();
    let snapshots = 0;
    // Events are counted, not kept, so the heap delta shows what rrweb holds on to.
    const emit = (event: eventWithTime) => {
      if (event.type === 2 /* FullSnapshot */) snapshots++;
    };
    const measured = await ctx.measure(async () => {
      let busyMs = 0;
      for (let i = 0; i < cycles; i++) {
        const start = performance.now();
        const stop = ctx.rrweb.record({ emit });
        if (!stop) throw new Error('rrweb.record did not start');
        stop();
        busyMs += performance.now() - start;
        // A task boundary between cycles, so maxBlockMs is one cycle's block.
        await nextTask();
      }
      return busyMs;
    });
    const after = heap();
    if (snapshots !== cycles) {
      return {
        ok: false,
        message: `${snapshots} full snapshots in ${cycles} cycles`,
      };
    }
    // durationMs is the time inside the cycles, without the yields.
    return sampleOf(
      { durationMs: measured.value, maxBlockMs: measured.maxBlockMs },
      before === undefined || after === undefined ? undefined : after - before,
    );
  },
};

/** Performance scenarios, in plan order. */
export const perfChecks: CheckDefinition[] = [
  largeStylesheet,
  snapshotScenario('perf-snapshot-5k', 5_000, 'focused'),
  snapshotScenario('perf-snapshot-20k', 20_000, 'focused'),
  // A 50,000-node snapshot blocks 600 to 1100 ms on GitHub runners, so the
  // 1000 ms ceiling would fail it on a slow runner or browser.
  snapshotScenario('perf-snapshot-50k', 50_000, 'full', 3000),
  mutationBurst,
  sampledCanvases,
  recordStopCycles,
];
