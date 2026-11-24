// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { EventType, IncrementalSource, MouseInteractions } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import { Replayer } from '../../src/replay';

let player: Replayer;
afterEach(() => player?.destroy());
it('recomputes inactivity on play, seek, pause, and tempo changes', () => {
  const click = (timestamp: number): eventWithTime => ({
    type: EventType.IncrementalSnapshot,
    timestamp,
    data: {
      source: IncrementalSource.MouseInteraction,
      type: MouseInteractions.Click,
      id: -1,
      x: 1,
      y: 1,
    },
  });
  player = new Replayer(
    [
      click(10000),
      click(130000),
      click(131000),
      {
        type: EventType.Custom,
        timestamp: 300000,
        data: { tag: 'end', payload: {} },
      },
    ],
    { skipInactive: true },
  );
  player.play(20000);
  expect(player.speedService.state.value).toBe('skipping');
  player.setConfig({ speed: 2 });
  expect(player.speedService.state.value).toBe('skipping');
  player.play(120500);
  expect(player.speedService.state.context.timer.speed).toBe(2);
  player.play(125000);
  expect(player.speedService.state.value).toBe('skipping');
  player.pause();
  expect(player.speedService.state.context.timer.speed).toBe(2);
});
