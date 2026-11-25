// @vitest-environment happy-dom
import { EventType } from '@rrweb/types';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Player from '../src/Player.svelte';
import type { PlayerFeatures } from '../src/features';

let player: Player;
let target: HTMLDivElement;

async function mount(features: PlayerFeatures) {
  target = document.createElement('div');
  document.body.append(target);
  player = new Player({
    target,
    props: {
      events: [
        {
          type: EventType.Meta,
          timestamp: 1000,
          data: { href: 'https://example.com', width: 800, height: 600 },
        },
        {
          type: EventType.Custom,
          timestamp: 3000,
          data: { tag: 'end', payload: {} },
        },
      ],
      autoPlay: false,
      features,
    },
  });
  await tick();
}

afterEach(() => {
  player?.$destroy();
  target?.remove();
});

describe('zoom customization', () => {
  it('uses the updated limit immediately and retains exact slider values', async () => {
    await mount({ zoom: { max: 2 } });
    player.setFeatures({ zoom: { max: 2.354 } });
    player.setZoom(5);
    await tick();

    const replay = target.querySelector<HTMLElement>('.replayer-wrapper')!;
    expect(replay.style.scale).toBe('2.354');
    target.querySelector<HTMLButtonElement>('[aria-label="Zoom"]')!.click();
    await tick();
    const slider = target.querySelector<HTMLInputElement>('[aria-label="Replay zoom"]')!;
    expect(slider.max).toBe('235.4');
    expect(slider.value).toBe('235.4');

    player.setFeatures({ zoom: false });
    player.setZoom(3);
    await tick();
    expect(replay.style.scale).toBe('1');
    expect(target.querySelector('[aria-label="Zoom"]')).toBeNull();
  });

  it('applies explicit follow updates without resetting the viewer on unrelated changes', async () => {
    await mount({ zoom: { followCursor: false } });
    target.querySelector<HTMLButtonElement>('[aria-label="Zoom"]')!.click();
    await tick();
    const follow = target.querySelector<HTMLInputElement>('[role="switch"][aria-label="Follow cursor"]')!;
    expect(follow.checked).toBe(false);
    follow.click();
    await tick();
    expect(follow.checked).toBe(true);

    player.setFeatures({ zoom: { max: 3 } });
    await tick();
    expect(follow.checked).toBe(true);

    player.setFeatures({ zoom: { followCursor: false } });
    await tick();
    expect(follow.checked).toBe(false);

    player.setFeatures({ zoom: { allowFollow: false, followCursor: true } });
    await tick();
    expect(target.querySelector('[aria-label="Zoom"] input[type="checkbox"]')).toBeNull();
  });
});
