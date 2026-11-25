// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { EventType, IncrementalSource, MouseInteractions } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import Player from '../src/Player.svelte';

const start = 1_700_000_000_000;
const custom = (offset: number, tag: string): eventWithTime => ({
  type: EventType.Custom,
  timestamp: start + offset,
  data: { tag, payload: null },
});
const events: eventWithTime[] = [
  {
    type: EventType.Meta,
    timestamp: start,
    data: { href: 'https://example.com', width: 400, height: 240 },
  },
  {
    type: EventType.IncrementalSnapshot,
    timestamp: start + 10_000,
    data: {
      source: IncrementalSource.MouseInteraction,
      type: MouseInteractions.Click,
      id: 1,
      x: 0,
      y: 0,
    },
  },
  custom(30_000, 'Middle'),
  custom(60_000, 'End'),
];

let player: Player;
let target: HTMLElement;
afterEach(() => {
  player?.$destroy();
  target?.remove();
});

it('reprojects idle spans and marker positions when changing the cap or switching to linear time', async () => {
  target = document.body.appendChild(document.createElement('div'));
  player = new Player({
    target,
    props: {
      events: [...events],
      autoPlay: false,
      skipInactive: false,
      inactivePeriodThreshold: 15_000,
      features: { timeline: { maxIdleShare: 0.4 } },
    },
  });
  await tick();

  const track = target.querySelector<HTMLElement>('.rr-progress')!;
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 500, 18),
  );
  const assertPosition = (idleWidth: number, markerPosition: number) => {
    const idle = track.querySelector<HTMLElement>('[data-rrweb-part="idle"]')!;
    const marker = track.querySelector<HTMLElement>('[title="Middle"]')!;
    expect(parseFloat(idle.style.width)).toBeCloseTo(idleWidth);
    expect(parseFloat(marker.style.left)).toBeCloseTo(markerPosition);
    track.dispatchEvent(
      new MouseEvent('click', {
        clientX: (markerPosition / 100) * 500,
        bubbles: true,
      }),
    );
    expect(player.getReplayer().getCurrentTime()).toBeCloseTo(30_000);
  };

  assertPosition(40, 76);
  player.setFeatures({ timeline: false });
  await tick();
  assertPosition(100 * (50 / 60), 50);
});
