// @vitest-environment happy-dom
import { EventType, IncrementalSource } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import { tick } from 'svelte';
import { expect, it, vi } from 'vitest';
import Player from '../src/Player.svelte';

it.each([true, false])(
  'shows the skip indicator while skipping with showController=%s',
  async (showController) => {
    vi.useFakeTimers({
      toFake: [
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
        'setTimeout',
        'clearTimeout',
      ],
    });
    const target = document.createElement('div');
    document.body.append(target);
    const events: eventWithTime[] = [
      {
        type: EventType.Meta,
        timestamp: 10000,
        data: { href: 'https://example.com', width: 800, height: 400 },
      },
      {
        type: EventType.Custom,
        timestamp: 70000,
        data: { tag: 'end', payload: {} },
      },
    ];
    const player = new Player({
      target,
      props: { events, showController, autoPlay: false, skipInactive: true },
    });
    const indicator = () => target.querySelector('[data-rrweb-part="skip-indicator"]');

    try {
      await tick();
      expect(indicator()).toBeNull();

      player.play();
      await tick();
      expect(indicator()?.parentElement?.className).toBe('rr-player__viewport');
      expect(indicator()?.getAttribute('aria-hidden')).toBe('true');

      const skippingSpeed = player.getReplayer().timer.speed;
      player.$set({ showSkipIndicator: false });
      await tick();
      expect(indicator()).toBeNull();
      expect(player.getReplayer().timer.speed).toBe(skippingSpeed);

      player.$set({ showSkipIndicator: true });
      await tick();
      expect(indicator()).not.toBeNull();

      player.pause();
      await tick();
      expect(indicator()).toBeNull();

      player.play();
      await tick();
      expect(indicator()).not.toBeNull();

      vi.advanceTimersByTime(2000);
      await tick();
      expect(indicator()).toBeNull();
      expect(player.getReplayer().getCurrentTime()).toBe(60000);
    } finally {
      player.$destroy();
      target.remove();
      vi.useRealTimers();
    }
  },
);

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
    const adaptiveSpeed = timer.speed;
    expect(adaptiveSpeed).toBeGreaterThan(12);

    player.setInactivity({ adaptiveSkip: false });
    expect(timer.speed).toBe(12);
    player.setInactivity({ adaptiveSkip: true });
    expect(timer.speed).toBe(adaptiveSpeed);

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

    const setting = target.querySelector<HTMLInputElement>('input[role="switch"]')!;
    expect(setting.checked).toBe(true);

    player.setInactivity({ skipInactive: false, maxSpeed: undefined });
    await tick();
    expect(timer.speed).toBe(1);
    expect(setting.checked).toBe(false);

    setting.click();
    await tick();
    expect(setting.checked).toBe(true);
    expect(timer.speed).toBe(3);
  } finally {
    player.$destroy();
    target.remove();
  }
});
