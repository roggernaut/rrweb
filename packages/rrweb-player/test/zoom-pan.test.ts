// @vitest-environment happy-dom
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Replayer } from '@rrweb/replay';
import ZoomPan from '../src/components/ZoomPan.svelte';

let frame: HTMLElement;
let zoomPan: ZoomPan;

function mount() {
  frame = document.createElement('div');
  const replay = document.createElement('div');
  const cursor = document.createElement('div');
  cursor.className = 'replayer-mouse';
  replay.append(cursor);
  frame.append(replay);
  document.body.append(frame);
  Object.defineProperties(frame, {
    clientWidth: { value: 400 },
    clientHeight: { value: 300 },
  });
  vi.spyOn(replay, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 480),
  );

  zoomPan = new ZoomPan({
    target: frame,
    props: {
      frame,
      replay,
      zoom: 2,
      followCursor: false,
      replayer: {
        service: { state: { value: 'paused' } },
        getCurrentTime: () => 0,
        on() {},
        off() {},
      } as unknown as Replayer,
    },
  });
  const surface = frame.querySelector<HTMLDivElement>('.rr-player__surface')!;
  const capturedPointers = new Set<number>();
  Object.assign(surface, {
    setPointerCapture: (id: number) => capturedPointers.add(id),
    hasPointerCapture: (id: number) => capturedPointers.has(id),
    releasePointerCapture: (id: number) => capturedPointers.delete(id),
  });
  function pointer(type: string, x: number, y: number, pointerId = 1) {
    surface.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
        pointerId,
        isPrimary: pointerId === 1,
      }),
    );
    return tick();
  }

  return { replay, capturedPointers, pointer };
}

afterEach(() => {
  zoomPan.$destroy();
  frame.remove();
});

describe('zoomed replay panning', () => {
  it('centres only an axis outside the dead zone and holds the camera while paused', async () => {
    const { replay, pointer } = mount();
    Object.defineProperties(replay, {
      offsetWidth: { value: 800 },
      offsetHeight: { value: 480 },
    });
    const cursor = replay.querySelector<HTMLElement>('.replayer-mouse')!;
    cursor.style.cssText = 'left: 650px; top: 250px';
    zoomPan.$set({ followCursor: true });
    await tick();
    expect(replay.style.translate).toBe('-200px 0px');
    cursor.style.left = '0px';
    await tick();
    expect(replay.style.translate).toBe('-200px 0px');
    await pointer('pointerdown', 0, 0);
    await pointer('pointermove', 20, 10);
    expect(replay.style.translate).toBe('-180px 10px');
  });

  it('holds capture across successive pointer moves', async () => {
    const { replay, capturedPointers, pointer } = mount();
    await pointer('pointerdown', 100, 100);
    await pointer('pointermove', 120, 110);
    expect(replay.style.translate).toBe('20px 10px');
    expect(capturedPointers.has(1)).toBe(true);

    await pointer('pointermove', 160, 130);
    expect(replay.style.translate).toBe('60px 30px');

    await pointer('pointerup', 160, 130);
    expect(capturedPointers.has(1)).toBe(false);
    await pointer('pointermove', 180, 140);
    expect(replay.style.translate).toBe('60px 30px');
  });

  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])(
    'holds primary capture when another pointer fires %s',
    async (eventType) => {
      const { replay, capturedPointers, pointer } = mount();
      await pointer('pointerdown', 0, 0);
      await pointer('pointerdown', 10, 10, 2);
      await pointer(eventType, 10, 10, 2);
      expect(capturedPointers.has(1)).toBe(true);
      await pointer('pointermove', 30, 20);
      expect(replay.style.translate).toBe('30px 20px');
    },
  );
});
