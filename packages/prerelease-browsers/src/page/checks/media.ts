import type { eventWithTime } from '@rrweb/types';
import type { CheckDefinition } from '../harness.ts';

/** CanvasMutation events (IncrementalSnapshot source 9). */
function canvasEvents(events: eventWithTime[]) {
  return events.flatMap((e) =>
    e.type === 3 /* IncrementalSnapshot */ &&
    e.data.source === 9 /* CanvasMutation */
      ? [e.data]
      : [],
  );
}

const canvas2d: CheckDefinition = {
  id: 'canvas-2d',
  kind: 'functional',
  tier: 'focused',
  async run(ctx) {
    document.body.innerHTML = '<canvas id="c" width="64" height="64"></canvas>';
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    const recording = ctx.record({ recordCanvas: true });
    await ctx.nextFrame();
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#c00';
    context.fillRect(4, 4, 20, 20);
    const events = await recording.stop();

    if (!canvasEvents(events).length) {
      return { ok: false, message: 'no CanvasMutation event', events };
    }
    return { ok: true, events };
  },
};

const canvasWebgl: CheckDefinition = {
  id: 'canvas-webgl',
  kind: 'functional',
  tier: 'full',
  async run(ctx) {
    // A canvas keeps the first context type it gets, so probe on another one.
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl')) return { ok: true, skipped: 'no webgl' };
    document.body.innerHTML = '<canvas id="c" width="64" height="64"></canvas>';
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    const recording = ctx.record({ recordCanvas: true });
    await ctx.nextFrame();
    const gl = canvas.getContext('webgl')!;
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const events = await recording.stop();

    if (!canvasEvents(events).length) {
      return { ok: false, message: 'no CanvasMutation event', events };
    }
    return { ok: true, events };
  },
};

const canvasSampled: CheckDefinition = {
  id: 'canvas-sampled',
  kind: 'functional',
  tier: 'full',
  async run(ctx) {
    document.body.innerHTML = '<canvas id="c" width="64" height="64"></canvas>';
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    let seen = false;
    const recording = ctx.record({
      recordCanvas: true,
      sampling: { canvas: 2 },
      emit(event) {
        if (
          event.type === 3 /* IncrementalSnapshot */ &&
          event.data.source === 9 /* CanvasMutation */
        ) {
          seen = true;
        }
      },
    });
    await ctx.nextFrame();
    const context = canvas.getContext('2d')!;
    // Draw something new every frame for 1500 ms, as an animation would.
    const start = performance.now();
    for (let frame = 0; performance.now() - start < 1500; frame++) {
      context.fillStyle = `hsl(${(frame * 7) % 360} 80% 50%)`;
      context.fillRect(0, 0, 64, 64);
      await ctx.nextFrame();
    }
    // Snapshots are taken off the main thread; give the last one time to land.
    const deadline = Date.now() + 2000;
    while (!seen && Date.now() < deadline) await ctx.sleep(50);
    const events = await recording.stop();

    if (!canvasEvents(events).length) {
      return { ok: false, message: 'no CanvasMutation event', events };
    }
    return { ok: true, events };
  },
};

/** One second of 8-bit mono silence at 8 kHz, as a WAV data URL. */
function silentWavUrl(): string {
  const rate = 8000;
  const bytes = new Uint8Array(44 + rate);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) =>
    [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + rate, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, rate, true);
  bytes.fill(128, 44); // 8-bit silence sits at the midpoint
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

const mediaPlayPause: CheckDefinition = {
  id: 'media-play-pause',
  kind: 'functional',
  tier: 'full',
  async run(ctx) {
    document.body.innerHTML = '<audio id="a" muted></audio>';
    const audio = document.getElementById('a') as HTMLAudioElement;
    audio.src = silentWavUrl();
    const recording = ctx.record();
    await ctx.nextFrame();
    let played = true;
    try {
      await audio.play();
    } catch {
      played = false;
    }
    audio.pause();
    const events = await recording.stop();
    if (!played) return { ok: true, skipped: 'play rejected', events };

    const id = ctx.rrweb.record.mirror.getId(audio);
    const types = events.flatMap((e) =>
      e.type === 3 /* IncrementalSnapshot */ &&
      e.data.source === 7 /* MediaInteraction */ &&
      e.data.id === id
        ? [e.data.type]
        : [],
    );
    // MediaInteractions.Play is 0 and Pause is 1.
    if (!types.includes(0) || !types.includes(1)) {
      return {
        ok: false,
        message: `MediaInteraction types recorded: [${types.join(
          ', ',
        )}], expected 0 and 1`,
        events,
      };
    }
    return { ok: true, events };
  },
};

export const mediaChecks: CheckDefinition[] = [
  canvas2d,
  canvasWebgl,
  canvasSampled,
  mediaPlayPause,
];
