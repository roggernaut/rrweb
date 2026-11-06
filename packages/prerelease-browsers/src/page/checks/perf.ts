import type { eventWithTime } from '@rrweb/types';
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

/** Measures the `record()` call, which takes the full snapshot. */
async function measureSnapshot(ctx: CheckContext): Promise<AttemptResult> {
  await settle(ctx);
  const measured = await ctx.measure(() => ctx.record());
  const events = await measured.value.stop();
  if (!hasFullSnapshot(events)) {
    return { ok: false, message: 'no full snapshot' };
  }
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
    for (let i = 0, n = scaled(ctx, 20_000); i < n; i++) {
      const color = (i % 4096).toString(16).padStart(3, '0');
      rules.push(
        `.r${i} > .c${i}:hover { color: #${color}; margin: 1px 2px 3px 4px; border: 1px solid #000; padding: 0 1px; }`,
      );
    }
    const style = document.createElement('style');
    style.textContent = rules.join('\n');
    document.head.appendChild(style);
    document.body.innerHTML = '<div class="r0"><span class="c0">x</span></div>';
    return measureSnapshot(ctx);
  },
};

function snapshotScenario(
  id: string,
  count: number,
  tier: Tier,
): CheckDefinition {
  return {
    id,
    kind: 'performance',
    tier,
    compare: ['durationMs'],
    async run(ctx) {
      fillBody(scaled(ctx, count));
      return measureSnapshot(ctx);
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
    await recording.stop();
    if (!measured.value) {
      return { ok: false, message: 'no Mutation event within 10000 ms' };
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
    for (let i = 0, n = scaled(ctx, 4); i < n; i++) {
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
    let mutations = 0;
    let recording: ReturnType<CheckContext['record']> | undefined;
    const measured = await ctx.measure(async () => {
      recording = ctx.record({
        recordCanvas: true,
        sampling: { canvas: 15 },
        emit(event) {
          if (
            event.type === 3 /* IncrementalSnapshot */ &&
            event.data.source === 9 /* CanvasMutation */
          ) {
            mutations++;
          }
        },
      });
      await ctx.sleep(3000);
    });
    drawing = false;
    await recording!.stop();
    if (mutations === 0) {
      return { ok: false, message: 'no CanvasMutation event in 3000 ms' };
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
    // Collects garbage first where the engine exposes gc(), to cut noise.
    const heap = () => {
      (window as { gc?: () => void }).gc?.();
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
    const measured = await ctx.measure(() => {
      for (let i = 0; i < cycles; i++) {
        const stop = ctx.rrweb.record({ emit });
        if (!stop) throw new Error('rrweb.record did not start');
        stop();
      }
    });
    const after = heap();
    if (snapshots !== cycles) {
      return {
        ok: false,
        message: `${snapshots} full snapshots in ${cycles} cycles`,
      };
    }
    return sampleOf(
      measured,
      before === undefined || after === undefined ? undefined : after - before,
    );
  },
};

/** Performance scenarios, in plan order. */
export const perfChecks: CheckDefinition[] = [
  largeStylesheet,
  snapshotScenario('perf-snapshot-5k', 5_000, 'focused'),
  snapshotScenario('perf-snapshot-20k', 20_000, 'focused'),
  snapshotScenario('perf-snapshot-50k', 50_000, 'full'),
  mutationBurst,
  sampledCanvases,
  recordStopCycles,
];
