// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { EventType, IncrementalSource, MouseInteractions } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import Player from '../src/Player.svelte';
import type { PlayerFeatures } from '../src/features';

const start = 1_700_000_000_000;
const events: eventWithTime[] = [
  {
    type: EventType.Meta,
    timestamp: start,
    data: { href: 'https://example.com', width: 400, height: 240 },
  },
  {
    type: EventType.IncrementalSnapshot,
    timestamp: start + 1000,
    data: {
      source: IncrementalSource.Input,
      id: 1,
      text: 'Example',
      isChecked: false,
    },
  },
  {
    type: EventType.IncrementalSnapshot,
    timestamp: start + 2000,
    data: {
      source: IncrementalSource.MouseInteraction,
      type: MouseInteractions.Click,
      id: 1,
      x: 0,
      y: 0,
    },
  },
  {
    type: EventType.Custom,
    timestamp: start + 4000,
    data: { tag: 'End', payload: null },
  },
];

let player: Player;
let target: HTMLElement;
async function mount(
  activity: PlayerFeatures['activity'],
  inactivePeriodThreshold?: number,
) {
  target = document.body.appendChild(document.createElement('div'));
  player = new Player({
    target,
    props: {
      events: [...events],
      autoPlay: false,
      skipInactive: false,
      ...(inactivePeriodThreshold !== undefined && { inactivePeriodThreshold }),
      features: { activity },
    },
  });
  await tick();
}
const graph = () =>
  target.querySelector<HTMLButtonElement>('[data-rrweb-part="activity"]');
const trigger = () =>
  target.querySelector<HTMLButtonElement>('[aria-label="Timeline layers"]');
const getSwitch = (text: string) =>
  [...target.querySelectorAll('label')]
    .find((label) => label.textContent?.includes(text))
    ?.querySelector('input');

afterEach(() => {
  player?.$destroy();
  target?.remove();
});

it('separates allowed layers from the initial selection and retains viewer choices', async () => {
  await mount({
    allowedLayers: ['inputs', 'clicks'],
    initialLayers: ['clicks', 'scroll'],
  });

  expect(graph()?.querySelector('path')).toBeNull();
  expect(graph()?.querySelector('line')?.getAttribute('stroke')).toContain(
    '--rrweb-player-activity-clicks',
  );
  trigger()!.click();
  await tick();
  expect(getSwitch('Scroll')).toBeUndefined();
  expect(getSwitch('Input events')?.checked).toBe(false);
  expect(getSwitch('Clicks')?.checked).toBe(true);

  getSwitch('Input events')!.click();
  getSwitch('Clicks')!.click();
  await tick();
  expect(graph()?.querySelector('path')?.getAttribute('fill')).toContain(
    '--rrweb-player-activity-inputs',
  );
  expect(graph()?.querySelector('line')).toBeNull();

  getSwitch('Activity')!.click();
  await tick();
  expect(graph()).toBeNull();
  expect(getSwitch('Input events')?.disabled).toBe(true);
  getSwitch('Activity')!.click();
  await tick();
  player.setFeatures({ activity: { seek: false } });
  await tick();
  expect(graph()?.querySelector('path')).toBeTruthy();
  expect(graph()?.querySelector('line')).toBeNull();
});

it('hides both entry points when disabled or when no layers are allowed', async () => {
  await mount(false);
  expect(graph()).toBeNull();
  expect(trigger()).toBeNull();

  player.setFeatures({ activity: { allowedLayers: [] } });
  await tick();
  expect(graph()).toBeNull();
  expect(trigger()).toBeNull();

  player.setFeatures({
    activity: { allowedLayers: ['clicks'], initialLayers: [] },
  });
  await tick();
  expect(graph()).toBeNull();
  expect(trigger()).toBeTruthy();
});

it('disables graph seeking and clears the pending keyboard target', async () => {
  await mount({ allowedLayers: ['clicks'] });
  player.goto(0, false);
  await tick();

  const button = graph()!;
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 400, 60),
  );
  button.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
  );
  await tick();
  expect(button.querySelector('[stroke-dasharray]')).toBeTruthy();

  player.setFeatures({ activity: { seek: false } });
  await tick();
  expect(button.disabled).toBe(true);
  expect(button.querySelector('[stroke-dasharray]')).toBeNull();
  button.dispatchEvent(
    new MouseEvent('click', { clientX: 200, detail: 1, bubbles: true }),
  );
  expect(player.getReplayer().getCurrentTime()).toBe(0);

  player.setFeatures({ activity: { seek: true } });
  await tick();
  button.click();
  expect(player.getReplayer().getCurrentTime()).toBe(0);
  button.dispatchEvent(
    new MouseEvent('click', { clientX: 200, detail: 1, bubbles: true }),
  );
  expect(player.getReplayer().getCurrentTime()).toBe(2000);
});

it('uses the same timeline projection for the click mark and graph seeking', async () => {
  await mount({ allowedLayers: ['clicks'] }, 1200);
  player.setFeatures({ timeline: { maxIdleShare: 0.2 } });
  await tick();

  const button = graph()!;
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 1000, 60),
  );
  const assertPosition = (position: number) => {
    const mark = Number(button.querySelector('line')?.getAttribute('x1'));
    expect(mark).toBeCloseTo(position);
    button.dispatchEvent(
      new MouseEvent('click', { clientX: mark, detail: 1, bubbles: true }),
    );
    expect(player.getReplayer().getCurrentTime()).toBeCloseTo(2000);
  };
  assertPosition(800);

  player.setFeatures({ timeline: false });
  await tick();
  assertPosition(500);
});
