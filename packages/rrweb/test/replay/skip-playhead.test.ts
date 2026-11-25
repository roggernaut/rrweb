// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  EventType,
  IncrementalSource,
  MouseInteractions,
  ReplayerEvents,
} from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import { Replayer } from '../../src/replay';

let player: Replayer;
afterEach(() => player?.destroy());

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

const custom = (timestamp: number): eventWithTime => ({
  type: EventType.Custom,
  timestamp,
  data: { tag: 'custom', payload: {} },
});

it('recomputes inactivity on play, seek, pause, and tempo changes', () => {
  player = new Replayer(
    [click(10000), click(130000), click(131000), custom(300000)],
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

it('does not start skipping while seeking in a paused replay', () => {
  player = new Replayer([click(10000), click(130000)], { skipInactive: true });
  const onSkipStart = vi.fn();
  player.on(ReplayerEvents.SkipStart, onSkipStart);

  player.pause(20000);

  expect(player.getCurrentTime()).toBe(20000);
  expect(player.service.state.value).toBe('paused');
  expect(onSkipStart).not.toHaveBeenCalled();
});

it('keeps an active skip when appended events leave its boundary intact', async () => {
  player = new Replayer([click(10000), click(130000)], { skipInactive: true });
  const onSkipStart = vi.fn();
  const onSkipEnd = vi.fn();
  player.on(ReplayerEvents.SkipStart, onSkipStart);
  player.on(ReplayerEvents.SkipEnd, onSkipEnd);
  player.play(20000);

  player.addEvent(custom(60000));
  await Promise.resolve();
  await Promise.resolve();

  expect(onSkipStart).toHaveBeenCalledTimes(1);
  expect(onSkipEnd).not.toHaveBeenCalled();

  player.addEvent(click(60000));
  await Promise.resolve();
  await Promise.resolve();

  expect(onSkipStart).toHaveBeenCalledTimes(2);
  expect(onSkipEnd).toHaveBeenCalledTimes(1);
  expect(player.timer.skipEnd).toBe(30000);
});
