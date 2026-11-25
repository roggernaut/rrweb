// @vitest-environment happy-dom
import { EventType } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import { tick } from 'svelte';
import { expect, it } from 'vitest';
import Player from '../src/Player.svelte';

it.each([true, false])(
  'shows the skip indicator while skipping with showController=%s',
  async (showController) => {
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
    const indicator = () => target.querySelector('.rr-player__skip-indicator');

    try {
      await tick();
      expect(indicator()).toBeNull();

      player.play();
      await tick();
      expect(indicator()?.parentElement?.className).toBe('rr-player__viewport');
      expect(indicator()?.getAttribute('aria-hidden')).toBe('true');

      player.pause();
      await tick();
      expect(indicator()).toBeNull();
    } finally {
      player.$destroy();
      target.remove();
    }
  },
);
