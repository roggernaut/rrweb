// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pack } from '@rrweb/packer';
import { tick } from 'svelte';
import {
  EventType,
  IncrementalSource,
  MouseInteractions,
  NodeType,
} from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import Player from '../src/Player.svelte';
import * as annotations from '../src/annotations';

const start = 1700000000000;
const annotation = (offset: number, text: string): eventWithTime => ({
  type: EventType.Annotation,
  timestamp: start + offset,
  data: { type: 'caption', text },
});
const timelineMarker = (offset: number, text: string): eventWithTime => ({
  type: EventType.Annotation,
  timestamp: start + offset,
  data: { type: 'timelineMarker', text },
});
const clear = (offset: number): eventWithTime => ({
  type: EventType.Annotation,
  timestamp: start + offset,
  data: { type: 'caption', text: null },
});
const replayClick = (offset: number): eventWithTime => ({
  type: EventType.IncrementalSnapshot,
  timestamp: start + offset,
  data: {
    source: IncrementalSource.MouseInteraction,
    type: MouseInteractions.Click,
    id: 1,
    x: 20,
    y: 20,
  },
});
const recording = (): eventWithTime[] => [
  {
    type: EventType.Meta,
    timestamp: start,
    data: { href: 'https://example.com', width: 800, height: 400 },
  },
  annotation(2000, 'Click Save\n<b>project</b>'),
  timelineMarker(2000, 'Click Save to create your project.'),
  clear(5000),
  {
    type: EventType.Custom,
    timestamp: start + 6000,
    data: { tag: 'ordinary', payload: { text: 'unrelated' } },
  },
  {
    type: EventType.IncrementalSnapshot,
    timestamp: start + 10000,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [],
      removes: [],
      adds: [],
    },
  },
];
let player: Player | undefined;
let target: HTMLDivElement;
async function mount(props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  player = new Player({
    target,
    props: {
      events: recording(),
      autoPlay: false,
      skipInactive: false,
      ...props,
    },
  });
  await tick();
  return player;
}
function click(selector: string) {
  const element = target.querySelector(selector);
  expect(element).toBeInstanceOf(HTMLElement);
  if (element instanceof HTMLElement) element.click();
}
afterEach(() => {
  player?.$destroy();
  target?.remove();
  vi.useRealTimers();
});

describe('player customization', () => {
  it('describes configured jumps with their source and supports unsubscribing', async () => {
    const player = await mount({
      features: { jump: { seconds: 2, keyboard: 'player' } },
    });
    const onJump = vi.fn();
    const unsubscribe = player.addEventListener('ui-jump', onJump);
    const root = target.querySelector<HTMLElement>(
      '[data-rrweb-part="player"]',
    )!;
    const arrow = (element: HTMLElement) =>
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }),
      );

    player.goto(0, false);
    expect(arrow(document.body)).toBe(true);
    expect(arrow(root)).toBe(false);
    click('[data-rrweb-control="jump-forward"]');
    player.setFeatures({ jump: { seconds: 3 } });
    player.jump('forward');
    await tick();

    expect(onJump.mock.calls.flat()).toEqual([
      { fromMs: 0, toMs: 2000, source: 'keyboard' },
      { fromMs: 2000, toMs: 4000, source: 'button' },
      { fromMs: 4000, toMs: 7000, source: 'api' },
    ]);
    expect(root.tabIndex).toBe(0);
    expect(arrow(document.body)).toBe(true);
    unsubscribe();
    player.jump('forward');
    expect(player.getReplayer().getCurrentTime()).toBe(10000);
    expect(onJump).toHaveBeenCalledTimes(3);

    player.setFeatures({ jump: { seconds: 1 } });
    await tick();
    expect(
      target
        .querySelector('[data-rrweb-control="jump-forward"]')
        ?.getAttribute('aria-label'),
    ).toMatch(/\b1 second$/);

    player.setFeatures({ jump: false });
    await tick();
    expect(
      target.querySelector('[data-rrweb-control="jump-forward"]'),
    ).toBeNull();
    player.jump('back');
    expect(player.getReplayer().getCurrentTime()).toBe(10000);
  });

  it('jumps back from the end when the playback clock has advanced past it', async () => {
    const player = await mount({ features: { jump: { seconds: 2 } } });
    const onJump = vi.fn();
    player.addEventListener('ui-jump', onJump);
    const currentTime = vi.spyOn(player.getReplayer(), 'getCurrentTime')
      .mockReturnValueOnce(10040);
    try {
      player.jump('back');
      expect(onJump).toHaveBeenCalledWith({ fromMs: 10000, toMs: 8000, source: 'api' });
    } finally {
      currentTime.mockRestore();
    }
  });

  it('ignores a programmatic jump as soon as live replay starts', async () => {
    const player = await mount();
    const replayer = player.getReplayer();
    const onJump = vi.fn();
    player.addEventListener('ui-jump', onJump);
    replayer.startLive();
    player.jump('forward');

    expect(replayer.service.state.value).toBe('live');
    expect(onJump).not.toHaveBeenCalled();
  });

  it('hides jump controls independently and renders custom decorative SVGs', async () => {
    const render = vi.fn(({ document }: { document: Document }) =>
      document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    );
    const player = await mount({
      features: { jump: { seconds: 2 }, clickToPlay: false },
      controls: { jump: false },
      icons: { 'jump-forward': render },
    });
    const forward = () =>
      target.querySelector('[data-rrweb-control="jump-forward"]');

    expect(forward()).toBeNull();
    expect(target.querySelector('[data-rrweb-part="surface"]')).toBeNull();
    expect(render).not.toHaveBeenCalled();
    player.goto(0, false);
    player.jump('forward');
    expect(player.getReplayer().getCurrentTime()).toBe(2000);

    player.$set({ controls: { jump: true } });
    await tick();
    expect(render).toHaveBeenCalledWith({
      name: 'jump-forward',
      seconds: 2,
      document: target.ownerDocument,
    });
    const svg = forward()?.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
  });
});

describe('player transport', () => {
  it('returns zoom to Fit with Escape after using transport controls', async () => {
    await mount();
    click('[aria-label="Zoom"]');
    await tick();
    const slider = target.querySelector<HTMLInputElement>('[aria-label="Replay zoom"]')!;
    slider.value = '200';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    const replay = target.querySelector<HTMLElement>('.replayer-wrapper')!;
    expect(replay.style.scale).toBe('2');
    const transport = target.querySelector<HTMLButtonElement>('[aria-label="Skip back 10 seconds"]')!;
    transport.click(); transport.focus();
    transport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(replay.style.scale).toBe('1');
    expect(replay.style.translate).toBe('0px 0px');
    expect(target.querySelector('[role="dialog"][aria-label="Zoom"]')).toBeNull();
  });

  it("jumps without player focus and leaves inputs and the timeline in control", async () => {
    const player = await mount();
    const playerElement = target.querySelector<HTMLElement>(".rr-player")!;
    vi.spyOn(playerElement, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 400, 360),
    );
    const arrow = (el: Element, key: string) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    arrow(document.body, "ArrowRight");
    expect(player.getReplayer().getCurrentTime()).toBe(10000);
    expect(player.getReplayer().service.state.value).toBe("paused");
    const input = document.createElement("input");
    target.append(input);
    arrow(input, "ArrowLeft");
    expect(player.getReplayer().getCurrentTime()).toBe(10000);
    arrow(target.querySelector('[role="slider"]')!, "ArrowLeft");
    expect(player.getReplayer().getCurrentTime()).toBe(5000);
    click('[aria-label="Skip back 10 seconds"]');
    expect(player.getReplayer().getCurrentTime()).toBe(0);
    click('[aria-label="Skip forward 10 seconds"]');
    expect(player.getReplayer().getCurrentTime()).toBe(10000);
  });

  it("leaves page arrows available while the player is hidden or the page is editable", async () => {
    const player = await mount();
    const playerElement = target.querySelector<HTMLElement>(".rr-player")!;
    vi.spyOn(playerElement, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 400, 360),
    );
    const forward = () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );

    playerElement.style.visibility = "hidden";
    expect(forward()).toBe(true);
    expect(player.getReplayer().getCurrentTime()).toBeLessThan(10000);

    playerElement.style.visibility = "visible";
    document.designMode = "on";
    try {
      expect(forward()).toBe(true);
      expect(player.getReplayer().getCurrentTime()).toBeLessThan(10000);
    } finally {
      document.designMode = "off";
    }
  });

  it("allows a keyboard jump during an idle skip and ignores it during live playback", async () => {
    const player = await mount({ skipInactive: true });
    const replayer = player.getReplayer();
    const next = target.querySelector<HTMLButtonElement>(
      '[aria-label="Skip forward 10 seconds"]',
    )!;
    const surface = target.querySelector<HTMLButtonElement>(
      ".rr-player__surface",
    )!;
    const forward = () =>
      surface.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    player.goto(2000, false);

    replayer.speedService.send({
      type: "FAST_FORWARD",
      payload: { speed: 10 },
    });
    await tick();
    expect(next.disabled).toBe(false);
    expect(forward()).toBe(false);
    expect(replayer.getCurrentTime()).toBe(10000);

    replayer.speedService.send({ type: "BACK_TO_NORMAL" });
    replayer.startLive();
    await tick();
    expect(next.disabled).toBe(true);
    expect(forward()).toBe(true);
    expect(replayer.service.state.value).toBe("live");
  });

  it("toggles on a surface click and ignores a drag that leaves the surface", async () => {
    const player = await mount();
    const surface = target.querySelector<HTMLButtonElement>(
      ".rr-player__surface",
    )!;
    const state = () => player.getReplayer().service.state.value;
    const pointer = (type: string, x: number, pointerId = 1) =>
      surface.dispatchEvent(
        new PointerEvent(type, {
          button: 0,
          clientX: x,
          isPrimary: true,
          pointerId,
        }),
      );
    const mouseClick = () =>
      surface.dispatchEvent(new MouseEvent("click", { detail: 1 }));

    pointer("pointerdown", 1);
    pointer("pointerleave", -1);
    pointer("pointerup", 1);
    mouseClick();
    expect(state()).toBe("paused");

    pointer("pointerdown", 1);
    pointer("pointercancel", 1, 2);
    pointer("pointerup", 1);
    mouseClick();
    expect(state()).toBe("playing");

    surface.click();
    expect(state()).toBe("paused");
  });
});

describe('player fullscreen', () => {
  let fullscreenElement: Element | null;
  const exitFullscreen = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    fullscreenElement = null;
    exitFullscreen.mockClear();
    Object.defineProperties(document, {
      fullscreen: { configurable: true, get: () => fullscreenElement !== null },
      fullscreenElement: { configurable: true, get: () => fullscreenElement },
      exitFullscreen: { configurable: true, value: exitFullscreen },
    });
  });

  afterEach(() => {
    for (const property of ['fullscreen', 'fullscreenElement', 'exitFullscreen']) {
      Reflect.deleteProperty(document, property);
    }
  });

  it('fits fullscreen around the controls and restores the latest embedded size', async () => {
    const player = await mount({ width: 640, height: 360 });
    const root = target.querySelector<HTMLElement>('.rr-player')!;
    const viewport = root.querySelector<HTMLElement>('.rr-player__viewport')!;
    Object.defineProperties(root, {
      clientWidth: { value: 1200 },
      clientHeight: { value: 800 },
    });

    fullscreenElement = root;
    document.dispatchEvent(new Event('fullscreenchange'));
    await tick();
    expect([viewport.style.width, viewport.style.height]).toEqual([
      '1200px', '720px',
    ]);

    player.$set({ width: 500, height: 280, showController: false });
    await tick();
    expect([viewport.style.width, viewport.style.height]).toEqual([
      '1200px', '800px',
    ]);

    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    await tick();
    expect([viewport.style.width, viewport.style.height]).toEqual([
      '500px', '280px',
    ]);
  });

  it('only exits fullscreen when this player owns it', async () => {
    const player = await mount();
    const root = target.querySelector<HTMLElement>('.rr-player')!;
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(root, 'requestFullscreen', { value: requestFullscreen });

    fullscreenElement = target;
    player.toggleFullscreen();
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(exitFullscreen).not.toHaveBeenCalled();

    fullscreenElement = root;
    player.toggleFullscreen();
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });
});

describe('timeline activity', () => {
  it('shows a late click while paused and lets the viewer choose a seek time', async () => {
    const player = await mount();
    player.goto(0, false);
    await tick();
    expect(target.querySelector('.rr-activity')).toBeNull();
    player.addEvent(replayClick(4000));
    await Promise.resolve();
    await tick();
    await tick();
    const graph = target.querySelector<HTMLButtonElement>('.rr-activity')!;
    expect(graph?.querySelector('line')).toBeTruthy();
    graph.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(player.getReplayer().getCurrentTime()).toBe(0);
    graph.click();
    await tick();
    expect(player.getReplayer().getCurrentTime()).toBe(1000);
    expect(player.getReplayer().service.state.value).toBe('paused');
  });

  it('clears the keyboard choice after a pointer seek', async () => {
    const player = await mount({ events: [...recording(), replayClick(4000)] });
    const graph = target.querySelector<HTMLButtonElement>('.rr-activity')!;
    vi.spyOn(graph, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 0, 400, 60));
    const chooseNext = () => graph.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true,
    }));
    chooseNext();

    graph.dispatchEvent(new MouseEvent('click', { clientX: 180, detail: 1, bubbles: true }));
    await tick();

    expect(player.getReplayer().getCurrentTime()).toBe(2500);
    expect(graph.querySelector('[stroke-dasharray]')).toBeNull();
    chooseNext();
    graph.click();
    expect(player.getReplayer().getCurrentTime()).toBe(3500);
  });

  it('keeps the graph visible as the pointer moves over its upper portion', async () => {
    await mount({ events: [...recording(), replayClick(4000)] });
    const container = target.querySelector('.rr-player')!;
    const graph = target.querySelector('.rr-activity')!;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 200));
    const move = (element: Element, clientY: number) => element.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerType: 'mouse', clientY,
    }));
    move(container, 160);
    await tick();
    expect(graph.classList.contains('shown')).toBe(true);

    move(graph, 120);
    await tick();
    expect(graph.classList.contains('shown')).toBe(true);

    move(container, 100);
    await tick();
    expect(graph.classList.contains('shown')).toBe(false);
  });

  it('hides the graph when the only recorded layer is turned off', async () => {
    await mount({ events: [...recording(), replayClick(4000)] });
    expect(target.querySelector('.rr-activity')).toBeTruthy();

    click('[aria-label="Timeline layers"]');
    await tick();
    const labels = [...target.querySelectorAll('label')];
    labels.find((label) => label.textContent?.trim() === 'Clicks')?.control?.click();
    await tick();

    expect(target.querySelector('.rr-activity')).toBeNull();
    expect(target.querySelector('[aria-label="Timeline layers"]')).toBeTruthy();
  });
});

describe('player annotations', () => {
  it('keeps a dismissed popup closed when its toolbar control returns', async () => {
    const player = await mount();
    const dialog = () =>
      target.querySelector('[role="dialog"][aria-label="Playback speed"]');
    click('[aria-label="Playback speed"]');
    await tick();
    expect(dialog()).not.toBeNull();

    player.$set({ controls: { speed: false } });
    await tick();
    expect(dialog()).toBeNull();
    player.$set({ controls: { speed: true } });
    await tick();
    expect(dialog()).toBeNull();
    expect(
      target
        .querySelector('button[aria-label="Playback speed"]')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('retains a cast-only annotation across a later unannotated segment', async () => {
    const player = await mount({
      events: recording().filter(event => event.type !== EventType.Annotation),
    });
    click('[aria-label="Replay settings"]');
    await tick();
    const toggle = () => target.querySelector('[aria-label="Annotations"]');
    expect(toggle()).toBeNull();

    // Emit the engine notification without adding the annotation to its public list.
    player.getReplayer()['emitter'].emit('event-cast', annotation(1000, 'Order placed'));
    await tick();
    expect(toggle()).not.toBeNull();
    player.addEvent({
      type: EventType.Custom,
      timestamp: start + 12000,
      data: { tag: 'segment-end', payload: {} },
    });
    await Promise.resolve();
    await tick();
    expect(toggle()).not.toBeNull();
  });

  it('keeps annotations hidden across caption prop changes and appended events', async () => {
    const initialEvents = recording().filter(
      (event) => event.type !== EventType.Annotation,
    );
    const player = await mount({ events: initialEvents });
    click('[aria-label="Replay settings"]');
    await tick();
    const switchControl = () =>
      target.querySelector<HTMLInputElement>(
        '[role="switch"][aria-label="Annotations"]',
      );
    expect(switchControl()).toBeNull();

    player.addEvent(annotation(11000, 'Appended caption'));
    player.addEvent(timelineMarker(11000, 'Appended note'));
    await Promise.resolve();
    await tick();
    player.goto(11000, false);
    await tick();
    expect(switchControl()?.checked).toBe(true);
    expect(target.querySelector('.rr-player__caption')?.textContent).toBe(
      'Appended caption',
    );

    switchControl()?.click();
    player.$set({ showCaptions: false });
    await tick();
    player.$set({ showCaptions: true });
    player.addEvent(timelineMarker(12000, 'Another note'));
    await Promise.resolve();
    await tick();
    expect(switchControl()?.checked).toBe(false);
    expect(target.querySelector('.rr-player__caption')).toBeNull();
    expect(target.querySelector('.rr-custom-event')).toBeNull();
    expect(target.querySelector('[title="ordinary"]')).not.toBeNull();

    switchControl()?.click();
    await tick();
    expect(target.querySelector('.rr-player__caption')?.textContent).toBe(
      'Appended caption',
    );
    expect(target.querySelectorAll('.rr-custom-event')).toHaveLength(2);
  });

  it('keeps scrollable timeline marker panels outside the seek button and prevents timeline marker panel clicks from seeking', async () => {
    const player = await mount();
    player.goto(3000, false);
    await tick();
    const tooltip = target.querySelector('[role="dialog"]');
    expect(tooltip?.closest('button')).toBeNull();
    expect(tooltip?.getAttribute('tabindex')).toBe('0');
    tooltip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    tooltip?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    await tick();
    expect(player.getReplayer().getCurrentTime()).toBe(3000);
  });

  it('shows escaped captions on seek and clears them at their end', async () => {
    const player = await mount();
    const region = target.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.textContent?.trim()).toBe('');
    expect(target.querySelector('.rr-player__caption')).toBeNull();
    player.goto(2000, false);
    await tick();
    expect(target.querySelector('[role="status"]')).toBe(region);
    expect(target.querySelector('.rr-player__caption')?.textContent).toBe(
      'Click Save\n<b>project</b>',
    );
    expect(target.querySelector('.rr-player__caption b')).toBeNull();
    player.goto(5000, false);
    await tick();
    expect(target.querySelector('.rr-player__caption')).toBeNull();
    expect(target.querySelector('[role="status"]')).toBe(region);
    expect(region?.textContent?.trim()).toBe('');
    player.goto(2500, false);
    await tick();
    expect(target.querySelector('.rr-player__caption')?.textContent).toContain(
      'Click Save',
    );
  });

  it('shows captions by default at the recording start when mounted paused', async () => {
    const events: eventWithTime[] = [
      recording()[0],
      annotation(0, 'Intro caption'),
      { ...recording().at(-1)!, timestamp: start + 10000 },
    ];
    await mount({ events, autoPlay: false });
    expect(target.querySelector('.rr-player__caption')?.textContent).toBe(
      'Intro caption',
    );
  });

  it('shows a caption queued before meta immediately when mounted paused', async () => {
    const events: eventWithTime[] = [
      annotation(0, 'Queued intro caption'),
      {
        type: EventType.Meta,
        timestamp: start + 5,
        data: { href: 'https://example.com', width: 800, height: 400 },
      },
      { ...recording().at(-1)!, timestamp: start + 10000 },
    ];
    await mount({ events, autoPlay: false });
    expect(target.querySelector('.rr-player__caption')?.textContent).toBe(
      'Queued intro caption',
    );
  });

  it('toggles captions independently of timeline markers and preserves ordinary markers', async () => {
    const player = await mount({ showCaptions: false });
    player.goto(2500, false);
    await tick();
    expect(target.querySelector('.rr-player__caption')).toBeNull();
    expect(target.querySelector('[role="dialog"]')?.textContent).toContain(
      'Click Save',
    );
    expect(target.querySelector('[title="ordinary"]')).not.toBeNull();
    player.$set({ showCaptions: true });
    await tick();
    expect(target.querySelector('.rr-player__caption')).not.toBeNull();
    player.$set({ showCaptions: false });
    await tick();
    expect(target.querySelector('.rr-player__caption')).toBeNull();
    expect(target.querySelector('[role="dialog"]')?.textContent).toContain(
      'Click Save',
    );
  });

  it.each([true, false])(
    'toggles all annotations from settings with showCaptions initially %s',
    async (showCaptions) => {
      const player = await mount({ showCaptions });
      player.goto(2500, false);
      await tick();
      expect(!!target.querySelector('.rr-player__caption')).toBe(showCaptions);
      expect(target.querySelector('.rr-custom-event')).not.toBeNull();
      click('[aria-label="Replay settings"]');
      await tick();
      const toggle = target.querySelector<HTMLInputElement>(
        '[role="switch"][aria-label="Annotations"]',
      )!;
      expect(toggle.checked).toBe(true);
      toggle.click();
      await tick();
      expect(target.querySelector('.rr-player__caption')).toBeNull();
      expect(target.querySelector('.rr-custom-event')).toBeNull();
      expect(target.querySelector('[title="ordinary"]')).not.toBeNull();
      toggle.click();
      await tick();
      expect(target.querySelector('.rr-player__caption')).not.toBeNull();
      expect(target.querySelector('.rr-custom-event')).not.toBeNull();
    },
  );

  it('bounds ten-second skips and preserves playback state', async () => {
    const player = await mount();
    const position = () => target.querySelector('[aria-label="Playback position"]')?.getAttribute('aria-valuenow');
    click('[aria-label="Skip back 10 seconds"]');
    await tick();
    expect(position()).toBe('0');
    click('[aria-label="Skip forward 10 seconds"]');
    await tick();
    expect(position()).toBe('10000');
    expect(target.querySelector('[aria-label="Play"]')).not.toBeNull();
    click('[aria-label="Skip forward 10 seconds"]');
    await tick();
    expect(position()).toBe('10000');
    player.goto(1000, true);
    click('[aria-label="Skip back 10 seconds"]');
    await tick();
    expect(position()).toBe('0');
    expect(target.querySelector('[aria-label="Pause"]')).not.toBeNull();
  });

  it('disables ten-second skips during live playback', async () => {
    const player = await mount();
    const forward = target.querySelector<HTMLButtonElement>(
      '[aria-label="Skip forward 10 seconds"]',
    )!;
    const back = target.querySelector<HTMLButtonElement>(
      '[aria-label="Skip back 10 seconds"]',
    )!;
    expect(forward.disabled).toBe(false);
    expect(back.disabled).toBe(false);
    player.getReplayer().startLive();
    await tick();
    expect(forward.disabled).toBe(true);
    expect(back.disabled).toBe(true);
  });

  it('pins a hover-open popup on click and supports custom speed presets', async () => {
    const player = await mount({ speedOption: [1, 1.25, 3, 10] });
    const trigger = target.querySelector<HTMLButtonElement>('[aria-label="Playback speed"]')!;
    trigger.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await tick();
    const popup = target.querySelector<HTMLElement>('[role="dialog"][aria-label="Playback speed"]')!;
    expect(popup).not.toBeNull();
    trigger.click();
    await tick();
    expect(document.activeElement).toBe(popup);
    const fractionalPreset = popup.querySelector<HTMLButtonElement>(
      '[aria-label="1.25× speed"]',
    )!;
    expect(fractionalPreset.textContent?.trim()).toBe('1.25');
    fractionalPreset.click();
    await tick();
    expect(player.getReplayer().config.speed).toBe(1.25);
    click('[aria-label="10× speed"]');
    await tick();
    expect(player.getReplayer().config.speed).toBe(10);
    trigger.click();
    await tick();
    expect(target.querySelector('[role="dialog"][aria-label="Playback speed"]')).toBeNull();
  });

  it('keeps a focused popup open on sibling hover and switches on click', async () => {
    await mount();
    const speedTrigger = target.querySelector<HTMLButtonElement>(
      'button[aria-label="Playback speed"]',
    )!;
    const settingsTrigger = target.querySelector<HTMLButtonElement>(
      'button[aria-label="Replay settings"]',
    )!;
    const dialogs = () =>
      Array.from(target.querySelectorAll('.rr-controller__btns [role="dialog"]'));
    const hover = (element: HTMLElement) => {
      element.dispatchEvent(
        new PointerEvent('pointerenter', { pointerType: 'mouse' }),
      );
    };

    hover(speedTrigger);
    await tick();
    hover(settingsTrigger);
    await tick();
    expect(dialogs().map((dialog) => dialog.getAttribute('aria-label'))).toEqual([
      'Replay settings',
    ]);

    speedTrigger.click();
    await tick();
    const preset = target.querySelector<HTMLButtonElement>(
      'button[aria-label="2× speed"]',
    )!;
    preset.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    preset.focus();
    hover(settingsTrigger);
    await tick();
    expect(dialogs().map((dialog) => dialog.getAttribute('aria-label'))).toEqual([
      'Playback speed',
    ]);
    expect(document.activeElement).toBe(preset);

    settingsTrigger.click();
    await tick();
    expect(dialogs().map((dialog) => dialog.getAttribute('aria-label'))).toEqual([
      'Replay settings',
    ]);
    expect(document.activeElement).toBe(dialogs()[0]);
  });

  it('changes playback speed during a real idle skip', async () => {
    const events = [...recording(), { type: EventType.Custom, timestamp: start + 120000, data: { tag: 'end', payload: {} } }];
    const player = await mount({ events, skipInactive: true });
    const replayer = player.getReplayer();
    player.goto(2000, true);
    await tick();
    expect(replayer.speedService.state.value).toBe('skipping');
    click('button[aria-label="Playback speed"]');
    await tick();
    const preset = target.querySelector<HTMLButtonElement>('button[aria-label="2× speed"]')!;
    expect(preset.disabled).toBe(false);
    preset.click();
    await tick();
    expect(replayer.config.speed).toBe(2);
    expect(replayer.speedService.state.value).toBe('skipping');
    replayer.pause();
    expect(replayer.speedService.state.context.timer.speed).toBe(2);
  });
  it('supports accessible keyboard seeking on the timeline slider', async () => {
    const player = await mount();
    player.goto(3000, false);
    await tick();

    const timeline = target.querySelector<HTMLElement>('[role="slider"]');
    expect(timeline).not.toBeNull();
    expect(timeline?.getAttribute('aria-label')).toBe('Playback position');
    expect(timeline?.tabIndex).toBe(0);
    expect(timeline?.getAttribute('aria-valuemin')).toBe('0');
    expect(timeline?.getAttribute('aria-valuemax')).toBe('10000');
    expect(timeline?.getAttribute('aria-valuenow')).toBe('3000');
    const marker = target.querySelector<HTMLElement>('.rr-custom-event');
    expect(timeline?.contains(marker)).toBe(false);

    const press = async (key: string, handled: boolean) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      timeline?.dispatchEvent(event);
      await tick();
      expect(event.defaultPrevented).toBe(handled);
    };

    await press('ArrowRight', true);
    expect(player.getReplayer().getCurrentTime()).toBe(8000);
    expect(timeline?.getAttribute('aria-valuenow')).toBe('8000');
    await press('ArrowRight', true);
    expect(player.getReplayer().getCurrentTime()).toBe(10000);
    await press('ArrowRight', true);
    expect(player.getReplayer().getCurrentTime()).toBe(10000);
    await press('ArrowLeft', true);
    expect(player.getReplayer().getCurrentTime()).toBe(5000);
    await press('Home', true);
    expect(player.getReplayer().getCurrentTime()).toBe(0);
    await press('ArrowLeft', true);
    expect(player.getReplayer().getCurrentTime()).toBe(0);
    await press('End', true);
    expect(player.getReplayer().getCurrentTime()).toBe(10000);

    await press('x', false);
    expect(player.getReplayer().getCurrentTime()).toBe(10000);
    const descendantKey = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
    });
    marker?.dispatchEvent(descendantKey);
    await tick();
    expect(descendantKey.defaultPrevented).toBe(false);
    expect(player.getReplayer().getCurrentTime()).toBe(10000);
  });

  it('seeks to the exact recording end with a whole-second accessible range', async () => {
    const events = recording();
    events[events.length - 1] = {
      ...events.at(-1)!,
      timestamp: start + 10543,
    };
    const player = await mount({ events });
    const timeline = target.querySelector<HTMLElement>('[role="slider"]');
    expect(timeline?.getAttribute('aria-valuemax')).toBe('10000');

    timeline?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'End',
        bubbles: true,
        cancelable: true,
      }),
    );
    await tick();

    expect(player.getReplayer().getCurrentTime()).toBe(10543);
    expect(timeline?.getAttribute('aria-valuenow')).toBe('10000');
  });

  it('focuses the timeline slider after scrubbing so keyboard seeking works', async () => {
    const player = await mount();
    const progress = target.querySelector<HTMLElement>('.rr-progress');
    const timeline = target.querySelector<HTMLElement>('[role="slider"]');
    expect(progress).not.toBeNull();
    expect(timeline).not.toBeNull();
    if (!progress || !timeline) return;

    vi.spyOn(progress, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);
    progress.dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: 20 }),
    );
    await tick();

    expect(player.getReplayer().getCurrentTime()).toBe(2000);
    expect(document.activeElement).toBe(timeline);

    timeline.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }),
    );
    await tick();
    expect(player.getReplayer().getCurrentTime()).toBe(7000);
  });

  it('reports the floored whole-second timeline value while keeping exact replay time', async () => {
    const player = await mount();
    const timeline = target.querySelector<HTMLElement>('[role="slider"]');

    player.goto(3000, false);
    await tick();
    expect(timeline?.getAttribute('aria-valuenow')).toBe('3000');
    player.goto(3100, false);
    await tick();
    expect(player.getReplayer().getCurrentTime()).toBe(3100);
    expect(timeline?.getAttribute('aria-valuenow')).toBe('3000');
    player.goto(3200, false);
    await tick();
    expect(player.getReplayer().getCurrentTime()).toBe(3200);
    expect(timeline?.getAttribute('aria-valuenow')).toBe('3000');
    player.goto(4000, false);
    await tick();
    expect(player.getReplayer().getCurrentTime()).toBe(4000);
    expect(timeline?.getAttribute('aria-valuenow')).toBe('4000');
  });

  it('seeks exactly to a timeline marker and supports captions without controls', async () => {
    const player = await mount();
    click('.rr-custom-event');
    await tick();
    expect(player.getReplayer().getCurrentTime()).toBe(2000);
    expect(target.querySelector('.rr-player__caption')).not.toBeNull();
    player.$set({ showController: false });
    await tick();
    expect(target.querySelector('.rr-controller')).toBeNull();
    expect(target.querySelector('.rr-player__caption')).not.toBeNull();
  });

  it('refreshes annotations when events are added after mounting', async () => {
    const player = await mount();
    player.addEvent(annotation(7000, 'Added later'));
    player.addEvent(timelineMarker(7000, 'A new timeline marker'));
    await Promise.resolve();
    await tick();
    await tick();
    player.goto(7000, false);
    await tick();
    expect(target.querySelectorAll('.rr-custom-event')).toHaveLength(2);
    expect(target.querySelector('.rr-player__caption')?.textContent).toBe(
      'Added later',
    );
  });

  it('reprojects the paused playhead and exact markers after earlier events and a batched move arrive', async () => {
    const input = (offset: number): eventWithTime => ({
      type: EventType.IncrementalSnapshot,
      timestamp: start + offset,
      data: {
        source: IncrementalSource.Input,
        id: 1,
        text: '',
        isChecked: false,
      },
    });
    const custom = (offset: number, tag: string): eventWithTime => ({
      type: EventType.Custom,
      timestamp: start + offset,
      data: { tag, payload: {} },
    });
    const player = await mount({
      events: [
        recording()[0],
        {
          type: EventType.FullSnapshot,
          timestamp: start + 9000,
          data: {
            node: {
              id: 1,
              type: NodeType.Document,
              childNodes: [
                {
                  id: 2,
                  type: NodeType.Element,
                  tagName: 'html',
                  attributes: {},
                  childNodes: [],
                },
              ],
            },
            initialOffset: { left: 0, top: 0 },
          },
        },
        input(12000),
        input(13543),
        timelineMarker(13543, 'Mark'),
        custom(72000, 'End'),
      ],
    });
    const replayer = player.getReplayer();
    // Happy DOM does not expose the sandboxed iframe through frameElement.
    Object.defineProperty(replayer.iframe.contentWindow, 'frameElement', {
      value: replayer.iframe,
    });
    player.goto(13543, false);
    await tick();

    const progress = vi.fn();
    player.addEventListener('ui-update-progress', progress);
    replayer.addEvent(custom(-2000, 'Earlier start'));
    replayer.addEvent(custom(5000, 'inactive period'));
    replayer.addEvent({
      type: EventType.IncrementalSnapshot,
      timestamp: start + 25000,
      data: {
        source: IncrementalSource.MouseMove,
        positions: [-18000, -14500, -4000].map((timeOffset) => ({
          id: 2,
          x: 0,
          y: 0,
          timeOffset,
        })),
      },
    });
    await tick();
    await tick();

    const track = target.querySelector<HTMLElement>('.rr-progress')!;
    const idle = track.querySelectorAll<HTMLElement>('.rr-inactive-period');
    expect(idle).toHaveLength(1);
    expect(parseFloat(idle[0].style.left)).toBeCloseTo(80);
    expect(parseFloat(idle[0].style.width)).toBeCloseTo(20);
    const playhead = track.querySelector<HTMLElement>('.rr-progress__handler')!;
    const annotation = track.querySelector<HTMLElement>(
      '.rr-custom-event-container',
    )!;
    const tag = track.querySelector<HTMLElement>(
      '[title="inactive period"]:not(.rr-inactive-period)',
    )!;
    const markerPosition = (80 * 15543) / 23000;
    expect(parseFloat(annotation.style.left)).toBeCloseTo(markerPosition, 6);
    expect(parseFloat(tag.style.left)).toBeCloseTo((80 * 7000) / 23000, 6);
    expect(parseFloat(playhead.style.left)).toBeCloseTo(markerPosition, 6);
    expect(progress).toHaveBeenLastCalledWith({ payload: 15543 / 74000 });

    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 1000, 12),
    );
    track.dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: 900 }),
    );
    expect(replayer.getCurrentTime()).toBeCloseTo(48500, 6);
    click('.rr-custom-event');
    expect(replayer.getCurrentTime()).toBe(15543);
  });

  it('refreshes timeline metadata once for a synchronous batch from both append APIs', async () => {
    const player = await mount();
    const replayer = player.getReplayer();
    const metadata = vi.spyOn(replayer, 'getMetaData');
    player.addEvent(timelineMarker(15000, 'One'));
    replayer.addEvent(timelineMarker(20000, 'Two'));
    player.addEvent(timelineMarker(25000, 'Three'));
    await tick();
    await tick();
    expect(target.querySelectorAll('.rr-custom-event')).toHaveLength(4);
    expect(metadata).toHaveBeenCalledTimes(1);
  });

  async function expectPausedCaptionUpdate(
    addedEvent: eventWithTime,
    expectedCaption: string | null,
  ) {
    const endSnapshot: eventWithTime = {
      ...recording().at(-1)!,
      timestamp: start + 10000,
    };
    const player = await mount({
      events: [
        recording()[0],
        annotation(1000, 'Existing caption'),
        endSnapshot,
      ],
    });
    player.getReplayer().pause(7000);
    await tick();
    expect(target.querySelector('.rr-player__caption')?.textContent).toBe(
      'Existing caption',
    );

    player.addEvent(addedEvent);
    await Promise.resolve();
    await tick();
    await tick();

    expect(player.getReplayer().getCurrentTime()).toBe(7000);
    expect(
      target.querySelector('.rr-player__caption')?.textContent ?? null,
    ).toBe(expectedCaption);
  }

  it('refreshes a paused caption when a caption is appended before the playhead', async () => {
    await expectPausedCaptionUpdate(
      annotation(6000, 'Updated caption'),
      'Updated caption',
    );
  });

  it('refreshes a paused caption when a caption is appended at the playhead', async () => {
    await expectPausedCaptionUpdate(
      annotation(7000, 'Updated caption'),
      'Updated caption',
    );
  });

  it('clears a paused caption when a clear event is appended before the playhead', async () => {
    await expectPausedCaptionUpdate(clear(6000), null);
  });

  it('clears a paused caption when a clear event is appended at the playhead', async () => {
    await expectPausedCaptionUpdate(clear(7000), null);
  });

  it.each([false, true])(
    'keeps unchanged playback ticks out of Player (captions: %s)',
    async (showCaptions) => {
      vi.useFakeTimers({
        toFake: [
          'setTimeout',
          'clearTimeout',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'Date',
          'performance',
        ],
      });
      const player = await mount({ showCaptions });
      player.goto(2100, false);
      await tick();
      const updates = vi.spyOn(player.$$, 'update');
      const lookups = vi.spyOn(annotations, 'getActiveCaption');
      player.play();
      lookups.mockClear();
      await vi.advanceTimersByTimeAsync(1000);
      await tick();
      expect(updates).not.toHaveBeenCalled();
      expect(lookups).not.toHaveBeenCalled();
      updates.mockRestore();
      lookups.mockRestore();
    },
  );

  it('coalesces caption lookups when seeking across 100,000 captions', async () => {
    const events = [
      recording()[0],
      ...Array.from({ length: 100000 }, (_, i) => annotation(i + 1, String(i))),
      { ...recording().at(-1)!, timestamp: start + 100001 },
    ];
    const player = await mount({ events });
    const lookups = vi.spyOn(annotations, 'getActiveCaption');
    try {
      player.goto(100000, false);
      await tick();
      expect(target.querySelector('.rr-player__caption')?.textContent).toBe(
        '99999',
      );
      expect(lookups).toHaveBeenCalledTimes(1);
    } finally {
      lookups.mockRestore();
    }
  });

  it('restores captions across a later snapshot boundary and clears before the first caption', async () => {
    const events = recording();
    events.splice(3, 0, { ...events[0], timestamp: start + 3000 });
    const player = await mount({ events });
    player.getReplayer().pause(4000);
    await tick();
    expect(target.querySelector('.rr-player__caption')?.textContent).toContain(
      'Click Save',
    );
    player.getReplayer().pause(1000);
    await tick();
    expect(target.querySelector('.rr-player__caption')).toBeNull();
  });

  it('follows playback speed and freezes captions while paused', async () => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'Date',
        'performance',
      ],
    });
    const player = await mount();
    player.play();
    await vi.advanceTimersByTimeAsync(2500);
    await tick();
    expect(target.querySelector('.rr-player__caption')?.textContent).toContain(
      'Click Save',
    );
    player.pause();
    await vi.advanceTimersByTimeAsync(5000);
    await tick();
    expect(target.querySelector('.rr-player__caption')?.textContent).toContain(
      'Click Save',
    );
    player.setSpeed(4);
    player.play();
    await vi.advanceTimersByTimeAsync(750);
    await tick();
    expect(target.querySelector('.rr-player__caption')).toBeNull();
  });

  it('agrees with seeking after appending a caption at a queued timestamp', async () => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'Date',
        'performance',
      ],
    });
    const events = recording();
    events.splice(
      2,
      0,
      ...Array.from({ length: 10 }, (_, i) => annotation(2000, String(i))),
    );
    const player = await mount({ events });
    player.play();
    await vi.advanceTimersByTimeAsync(1000);
    player.addEvent(annotation(2000, 'Appended'));
    await vi.advanceTimersByTimeAsync(1500);
    await tick();
    expect(target.querySelector('.rr-player__caption')?.textContent).toBe(
      'Appended',
    );
    player.goto(2500, false);
    await tick();
    expect(target.querySelector('.rr-player__caption')?.textContent).toBe(
      'Appended',
    );
  });

  it('returns focus to the marker when Escape dismisses its focused panel', async () => {
    await mount();
    const marker = target.querySelector<HTMLButtonElement>('.rr-custom-event');
    const panel = target.querySelector<HTMLDivElement>('[role="dialog"]');
    panel?.focus();
    expect(document.activeElement).toBe(panel);
    panel?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await tick();
    expect(document.activeElement).toBe(marker);
    expect(target.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps the marker interactive and returns focus to it when Escape dismisses a panel during skipping', async () => {
    const player = await mount();
    player.goto(2000, false);
    await tick();
    const marker = target.querySelector<HTMLButtonElement>('.rr-custom-event');
    const panel = target.querySelector<HTMLDivElement>('[role="dialog"]');

    panel?.focus();
    expect(document.activeElement).toBe(panel);
    player.getReplayer().speedService.send({
      type: 'FAST_FORWARD',
      payload: { speed: 5 },
    });
    await tick();
    expect(player.getReplayer().speedService.state.value).toBe('skipping');
    expect(marker?.disabled).toBe(false);

    panel?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await tick();

    expect(target.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(marker);
    expect(player.getReplayer().getCurrentTime()).toBe(2000);
  });

  it('reads annotations from packed events', async () => {
    const player = await mount({
      events: recording().map((event) => pack(event)),
    });
    player.goto(2000, false);
    await tick();
    expect(target.querySelector('.rr-player__caption')?.textContent).toContain(
      'Click Save',
    );
  });

  it('omits the caption toggle when there are no annotations', async () => {
    await mount({
      events: recording().filter(
        (event) => event.type !== EventType.Annotation,
      ),
    });
    expect(target.querySelector('button[aria-pressed]')).toBeNull();
  });

  it('dismisses hover timeline marker panels with Escape even when the marker is not focused', async () => {
    await mount();
    expect(target.querySelector('[role="dialog"]')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
    target
      .querySelector('.rr-custom-event')
      ?.dispatchEvent(new Event('mouseenter'));
    await tick();
    expect(target.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('lets marker shortcuts bubble without seeking and dismisses focused timeline marker panels', async () => {
    const player = await mount();
    player.goto(2000, false);
    await tick();
    const marker = target.querySelector('.rr-custom-event');
    const keys: string[] = [];
    const onKey = (event: KeyboardEvent) => keys.push(event.key);
    window.addEventListener('keydown', onKey);
    try {
      for (const key of ['k', 'ArrowRight', 'Escape']) {
        marker?.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true }),
        );
      }
      await tick();
      expect(keys).toEqual(['k', 'ArrowRight', 'Escape']);
      expect(player.getReplayer().getCurrentTime()).toBe(2000);
      expect(target.querySelector('[role="dialog"]')).toBeNull();
      marker?.dispatchEvent(new Event('focus'));
      await tick();
      expect(target.querySelector('[role="dialog"]')).not.toBeNull();
      marker?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await tick();
      expect(target.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });

  it('shows timeline markers without a CC toggle when no caption set events exist', async () => {
    await mount({
      events: [
        recording()[0],
        timelineMarker(2000, 'Just a timeline marker'),
        clear(5000),
      ],
    });
    expect(target.querySelectorAll('.rr-custom-event')).toHaveLength(1);
    expect(target.querySelector('button[aria-pressed]')).toBeNull();
  });

  it('colors annotation markers separately from custom event tags', async () => {
    await mount({
      timelineMarkerColor: 'red',
      tags: { annotation: 'blue', ordinary: 'green' },
    });
    expect(
      (target.querySelector('.rr-custom-event__tick') as HTMLElement).style
        .background,
    ).toBe('red');
    expect(
      (target.querySelector('[title="ordinary"]') as HTMLElement).style
        .background,
    ).toBe('green');
  });

  it('emits annotation events separately from custom events during seeks', async () => {
    const player = await mount();
    const seen: eventWithTime[] = [];
    const custom: eventWithTime[] = [];
    player
      .getReplayer()
      .on('annotation', (event) => seen.push(event as eventWithTime));
    player
      .getReplayer()
      .on('custom-event', (event) => custom.push(event as eventWithTime));
    player.goto(6500, false);
    expect(
      seen.map(({ type, timestamp, data }) => ({ type, timestamp, data })),
    ).toEqual([
      annotation(2000, 'Click Save\n<b>project</b>'),
      timelineMarker(2000, 'Click Save to create your project.'),
      clear(5000),
    ]);
    expect(
      custom.map(({ type, timestamp, data }) => ({ type, timestamp, data })),
    ).toEqual([recording()[4]]);
  });

  it('never creates timeline markers for caption set, clear, or invalid annotation events', async () => {
    const player = await mount();
    expect(target.querySelectorAll('.rr-custom-event')).toHaveLength(1);
    expect(target.querySelector('[title="annotation"]')).toBeNull();
    player.addEvent({
      type: EventType.Annotation,
      timestamp: start + 7000,
      data: { type: 'caption', text: 123 } as never,
    });
    await Promise.resolve();
    await tick();
    await tick();
    player.goto(7000, false);
    await tick();
    expect(target.querySelector('.rr-player__caption')).toBeNull();
    expect(target.querySelector('[title="annotation"]')).toBeNull();
  });
});
