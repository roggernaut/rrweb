// @vitest-environment happy-dom
import { EventType } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import { expect, it } from 'vitest';
import { Replayer } from '../../src/replay';
import { inactiveSkipSpeed } from '../../src/replay/inactivity';

it('scales the target duration with gap length and tempo, respecting the configured ceiling', () => {
  expect(inactiveSkipSpeed(10000, 1, 1000)).toBe(10);
  expect(20000 / inactiveSkipSpeed(20000, 1, 1000)).toBe(1250);
  expect(5120000 / inactiveSkipSpeed(5120000, 1, 2000)).toBe(3000);
  expect(1500000 / inactiveSkipSpeed(1500000, 1, 1000)).toBeCloseTo(2807, -1);
  expect(inactiveSkipSpeed(60000, 2, 1000)).toBe(
    2 * inactiveSkipSpeed(60000, 1, 1000),
  );
  expect(inactiveSkipSpeed(1500000, 1, 360)).toBe(360);
});

it('applies a changed cap to the skip at the current playhead', () => {
  const events: eventWithTime[] = [
    {
      type: EventType.Custom,
      timestamp: 10000,
      data: { tag: 'start', payload: {} },
    },
    {
      type: EventType.Custom,
      timestamp: 70000,
      data: { tag: 'end', payload: {} },
    },
  ];
  const player = new Replayer(events, { skipInactive: true, maxSpeed: 20 });
  try {
    player.play();
    expect(player.speedService.state.context.timer.speed).toBe(20);
    const skipEvents: string[] = [];
    player.on('skip-start', () => skipEvents.push('start'));
    player.on('skip-end', () => skipEvents.push('end'));

    player.setConfig({ maxSpeed: 20 });
    expect(skipEvents).toHaveLength(0);

    player.setConfig({ maxSpeed: 5 });
    expect(player.speedService.state.context.timer.speed).toBe(5);

    player.setConfig({ maxSpeed: 1 });
    expect(player.speedService.state.context.timer.speed).toBe(1);

    player.setConfig({ maxSpeed: 15 });
    expect(player.speedService.state.context.timer.speed).toBe(15);
  } finally {
    player.destroy();
  }
});

it('uses the classic rate when adaptive skipping is disabled', () => {
  expect(inactiveSkipSpeed(60000, 1, 1000, false)).toBe(12);
  expect(inactiveSkipSpeed(10000, 4, 1000, false)).toBe(8);
  expect(inactiveSkipSpeed(60000, 1, 5, false)).toBe(5);
});

it('changes the active skip rate when adaptive skipping is toggled', () => {
  const events: eventWithTime[] = [
    {
      type: EventType.Custom,
      timestamp: 10000,
      data: { tag: 'start', payload: {} },
    },
    {
      type: EventType.Custom,
      timestamp: 70000,
      data: { tag: 'end', payload: {} },
    },
  ];
  const player = new Replayer(events, { skipInactive: true, adaptiveSkip: false });
  try {
    player.play();
    expect(player.timer.speed).toBe(12);

    player.setConfig({ adaptiveSkip: true });
    expect(player.timer.speed).toBe(inactiveSkipSpeed(60000, 1, 1000));

    player.setConfig({ adaptiveSkip: false });
    expect(player.timer.speed).toBe(12);
  } finally {
    player.destroy();
  }
});
