// @vitest-environment happy-dom
import { EventType } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import { expect, it } from 'vitest';
import { Replayer } from '../../src/replay';
import { inactiveSkipSpeed } from '../../src/replay/inactivity';
it('scales the target duration with gap length and tempo, respecting the configured ceiling', () => {
  expect(inactiveSkipSpeed(10000, 1, 1000)).toBe(10);
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
