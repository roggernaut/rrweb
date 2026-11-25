// @vitest-environment happy-dom
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Replayer } from '@rrweb/replay';
import ZoomPan from '../src/components/ZoomPan.svelte';

let frame: HTMLElement;
let zoomPan: ZoomPan;

function mount(playing = false) {
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
        service: { state: { value: playing ? 'playing' : 'paused' } },
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
  function pointer(
    type: string,
    x: number,
    y: number,
    pointerId = 1,
    isPrimary = pointerId === 1,
  ) {
    surface.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
        pointerId,
        isPrimary,
      }),
    );
    return tick();
  }

  return { replay, cursor, surface, capturedPointers, pointer };
}

afterEach(() => {
  zoomPan.$destroy();
  frame.remove();
  vi.unstubAllGlobals();
});

describe('zoomed replay panning', () => {
  it.each(['click', 'drag'] as const)(
    'holds the moving camera on pointerdown before a %s',
    async (gesture) => {
      const frames = new Map<number, FrameRequestCallback>();
      let frameId = 0;
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++frameId, callback);
        return frameId;
      });
      vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
      function animate() {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback(performance.now() + 64));
      }

      const { replay, cursor, surface, pointer } = mount(true);
      Object.defineProperties(replay, {
        offsetWidth: { value: 800 },
        offsetHeight: { value: 480 },
      });
      cursor.style.cssText = 'left: 650px; top: 240px';
      zoomPan.$set({ followCursor: true });
      await tick();
      expect(frames.size).toBe(1);

      await pointer('pointerdown', 100, 100);
      await pointer('pointermove', 103, 100);
      animate();
      expect(replay.style.translate).toBe('0px 0px');

      const toggle = vi.fn();
      zoomPan.$on('toggle', toggle);
      const endX = gesture === 'drag' ? 115 : 103;
      await pointer('pointerup', endX, 100);
      surface.dispatchEvent(new MouseEvent('click', { detail: 1 }));
      animate();

      if (gesture === 'drag') {
        expect(replay.style.translate).toBe('15px 0px');
        expect(toggle).not.toHaveBeenCalled();
      } else {
        expect(replay.style.translate).not.toBe('0px 0px');
        expect(toggle).toHaveBeenCalledOnce();
      }
    },
  );

  it('keeps the camera active during a press when manual pan is off', async () => {
    let animate: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animate = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      animate = undefined;
    });
    const { replay, cursor, capturedPointers, pointer } = mount(true);
    Object.defineProperties(replay, {
      offsetWidth: { value: 800 },
      offsetHeight: { value: 480 },
    });
    cursor.style.cssText = 'left: 650px; top: 240px';
    zoomPan.$set({ canPan: false, followCursor: true });
    await tick();
    expect(animate).toBeDefined();

    await pointer('pointerdown', 0, 0);
    await pointer('pointermove', 30, 20);
    expect(capturedPointers.size).toBe(0);
    expect(animate).toBeDefined();
    animate?.(performance.now() + 64);
    expect(replay.style.translate).not.toBe('0px 0px');
  });

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

  it('pans by the pointer delta when the embedding page scales the player', async () => {
    const { replay, pointer } = mount();
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 200, 150),
    );
    vi.mocked(replay.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, 0, 400, 240),
    );

    await pointer('pointerdown', 50, 50);
    await pointer('pointermove', 80, 70);
    expect(replay.style.translate).toBe('60px 40px');
    await pointer('pointerup', 200, 150);
    expect(replay.style.translate).toBe('200px 90px');
  });

  it('follows the cursor in replay coordinates when the embedding page scales the player', async () => {
    const { replay, cursor } = mount();
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 200, 150),
    );
    vi.mocked(replay.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, 0, 400, 240),
    );
    Object.defineProperties(replay, {
      offsetWidth: { value: 800 },
      offsetHeight: { value: 480 },
    });
    cursor.style.cssText = 'left: 550px; top: 140px';

    zoomPan.$set({ followCursor: true });
    await tick();
    expect(replay.style.translate).toBe('-150px 90px');
  });

  it('keeps the first captured pointer when another pointer type is primary', async () => {
    const { replay, capturedPointers, pointer } = mount();
    await pointer('pointerdown', 0, 0);
    await pointer('pointerdown', 10, 10, 2, true);
    await pointer('pointermove', 30, 20);
    expect([...capturedPointers]).toEqual([1]);
    expect(replay.style.translate).toBe('30px 20px');
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
