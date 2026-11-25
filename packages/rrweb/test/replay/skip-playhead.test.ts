// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  EventType,
  IncrementalSource,
  MouseInteractions,
  ReplayerEvents,
} from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import { Replayer } from '../../src/replay';

let player: Replayer;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
      'setTimeout',
      'clearTimeout',
    ],
  });
});
afterEach(() => {
  player?.destroy();
  vi.useRealTimers();
});

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

it('lands exactly on the next interaction before advancing at normal speed', () => {
  const interaction = click(130103);
  const afterInteraction = custom(130104);
  player = new Replayer(
    [click(10000), interaction, afterInteraction, custom(131000)],
    { skipInactive: true, speed: 4 },
  );
  const onEventCast = vi.fn();
  player.on(ReplayerEvents.EventCast, onEventCast);
  player.play(120000);
  onEventCast.mockClear();

  vi.advanceTimersByTime(16);

  expect(player.getCurrentTime()).toBe(120103);
  expect(player.timer.speed).toBe(4);
  expect(onEventCast.mock.calls).toEqual([[interaction]]);

  vi.advanceTimersByTime(16);

  expect(player.getCurrentTime()).toBe(120167);
  expect(onEventCast.mock.calls).toEqual([[interaction], [afterInteraction]]);
});

it('keeps a seek playing when an earlier skip reaches the recording end', () => {
  player = new Replayer([click(10000), custom(130103)], {
    skipInactive: true,
    speed: 4,
  });
  const onFinish = vi.fn();
  player.on(ReplayerEvents.Finish, onFinish);
  player.play(120000);
  vi.advanceTimersByTime(16);
  expect(player.getCurrentTime()).toBe(120103);
  expect(player.timer.speed).toBe(4);

  player.play(20000);
  vi.advanceTimersByTime(51);

  expect(player.service.state.value).toBe('playing');
  expect(player.speedService.state.value).toBe('skipping');
  expect(onFinish).not.toHaveBeenCalled();
});

it('finishes after a late append that does not change the recording end', async () => {
  player = new Replayer([click(10000), custom(130103)], {
    skipInactive: true,
    speed: 4,
  });
  const onFinish = vi.fn();
  player.on(ReplayerEvents.Finish, onFinish);
  player.play(120000);
  vi.advanceTimersByTime(16);

  player.addEvent(custom(130102));
  await Promise.resolve();
  await Promise.resolve();
  vi.advanceTimersByTime(51);

  expect(player.service.state.value).toBe('paused');
  expect(onFinish).toHaveBeenCalledTimes(1);
});

it('keeps normal speed after a scroll that follows the final mouse batch cast', () => {
  const scroll: eventWithTime = {
    type: EventType.IncrementalSnapshot,
    timestamp: 110000,
    data: { source: IncrementalSource.Scroll, id: -1, x: 0, y: 100 },
  };
  const finalBatch: eventWithTime = {
    type: EventType.IncrementalSnapshot,
    timestamp: 125000,
    data: {
      source: IncrementalSource.MouseMove,
      positions: [
        { id: -1, x: 0, y: 0, timeOffset: -20000 },
        { id: -1, x: 5, y: 5, timeOffset: -10000 },
        { id: -1, x: 10, y: 10, timeOffset: 0 },
      ],
    },
  };
  player = new Replayer([custom(10000), scroll, finalBatch], {
    skipInactive: true,
  });
  const onCast = vi.fn();
  const onSkipStart = vi.fn();
  const onFinish = vi.fn();
  player.on(ReplayerEvents.EventCast, onCast);
  player.on(ReplayerEvents.SkipStart, onSkipStart);
  player.on(ReplayerEvents.Finish, onFinish);

  player.play(94000);
  vi.advanceTimersByTime(1200);
  expect(onCast).toHaveBeenCalledWith(finalBatch);
  expect(onCast).not.toHaveBeenCalledWith(scroll);
  expect(player.timer.speed).toBe(1);

  vi.advanceTimersByTime(5500);
  expect(onCast).toHaveBeenCalledWith(scroll);
  expect(onSkipStart).toHaveBeenCalledTimes(1);
  expect(player.timer.speed).toBe(1);
  expect(player.getCurrentTime()).toBeLessThan(105000);
  expect(onFinish).not.toHaveBeenCalled();

  vi.advanceTimersByTime(15000);
  expect(onFinish).toHaveBeenCalledTimes(1);
});
