// @vitest-environment happy-dom
import { EventType, IncrementalSource } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import { tick } from 'svelte';
import { expect, it } from 'vitest';
import Player from '../src/Player.svelte';

it('updates the active skip and timeline when inactivity settings change', async () => {
  const target = document.createElement('div');
  document.body.append(target);
  const events: eventWithTime[] = [
    {
      type: EventType.Meta,
      timestamp: 10000,
      data: { href: 'https://example.com', width: 800, height: 400 },
    },
    {
      type: EventType.IncrementalSnapshot,
      timestamp: 70000,
      data: { source: IncrementalSource.Scroll, id: -1, x: 0, y: 100 },
    },
  ];
  const player = new Player({
    target,
    props: { events, autoPlay: false },
  });
  const timer = player.getReplayer().timer;
  const inactivityBar = () => target.querySelector('[title="inactive period"]');

  try {
    await tick();
    player.play();
    expect(inactivityBar()).not.toBeNull();
    expect(timer.speed).toBeGreaterThan(1);

    player.setInactivity({ inactivePeriodThreshold: 70000 });
    await tick();
    expect(inactivityBar()).toBeNull();
    expect(timer.speed).toBe(1);

    player.setInactivity({ inactivePeriodThreshold: 10000, maxSpeed: 5 });
    await tick();
    expect(inactivityBar()).not.toBeNull();
    expect(timer.speed).toBe(5);

    player.setInactivity({ maxSpeed: 3 });
    expect(timer.speed).toBe(3);

    player.setInactivity({ skipInactive: false, maxSpeed: undefined });
    await tick();
    expect(timer.speed).toBe(1);

    player.toggleSkipInactive();
    await tick();
    expect(timer.speed).toBe(3);
  } finally {
    player.$destroy();
    target.remove();
  }
});
