import * as vm from 'vm';
import { installVirtualClock } from '../src/virtual-clock';

type Clock = {
  advance: (ms: number) => Promise<void>;
};

type Sandbox = {
  window: Sandbox;
  performance: { now: () => number };
  setTimeout: (cb: () => void, ms?: number) => number;
  clearTimeout: (id: number) => void;
  setInterval: (cb: () => void, ms?: number) => number;
  clearInterval: (id: number) => void;
  requestAnimationFrame: (cb: (time: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
  __rrvideoClock: Clock;
  Promise: PromiseConstructor;
};

/**
 * Install the clock in a fresh context from its source text, the same way
 * replay-html inlines it, so a dependency on anything outside the function
 * body fails here.
 */
function install(): Sandbox {
  const context = {
    performance: { now: () => 1000 },
    setTimeout,
    Promise,
  } as unknown as Sandbox;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`(${installVirtualClock.toString()})();`, context);
  return context;
}

describe('virtual clock', () => {
  it('does not move or run timers until advanced', async () => {
    const w = install();
    const fired: string[] = [];
    w.setTimeout(() => fired.push('timeout'), 0);
    w.requestAnimationFrame(() => fired.push('raf'));
    expect(w.performance.now()).toBe(1000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fired).toEqual([]);
    expect(w.performance.now()).toBe(1000);
  });

  it('runs timers in due order at their due time, then animation frames', async () => {
    const w = install();
    const fired: Array<[string, number]> = [];
    w.setTimeout(() => fired.push(['b', w.performance.now()]), 10);
    w.setTimeout(() => fired.push(['a', w.performance.now()]), 5);
    w.setTimeout(() => fired.push(['later', w.performance.now()]), 50);
    w.requestAnimationFrame((time) => fired.push(['raf', time]));

    await w.__rrvideoClock.advance(16);

    expect(fired).toEqual([
      ['a', 1005],
      ['b', 1010],
      ['raf', 1016],
    ]);
    expect(w.performance.now()).toBe(1016);
  });

  it('runs timers scheduled by a timer within the same advance', async () => {
    const w = install();
    const fired: number[] = [];
    w.setTimeout(() => {
      fired.push(w.performance.now());
      w.setTimeout(() => fired.push(w.performance.now()), 4);
    }, 2);
    await w.__rrvideoClock.advance(10);
    expect(fired).toEqual([1002, 1006]);
  });

  it('gives animation frames one callback per advance', async () => {
    const w = install();
    const times: number[] = [];
    const loop = (time: number) => {
      times.push(time);
      w.requestAnimationFrame(loop);
    };
    w.requestAnimationFrame(loop);
    await w.__rrvideoClock.advance(16);
    await w.__rrvideoClock.advance(16);
    expect(times).toEqual([1016, 1032]);
  });

  it('repeats intervals and honours clear functions', async () => {
    const w = install();
    let ticks = 0;
    const interval = w.setInterval(() => ticks++, 10);
    const cancelled = w.setTimeout(() => (ticks += 100), 5);
    const frame = w.requestAnimationFrame(() => (ticks += 1000));
    w.clearTimeout(cancelled);
    w.cancelAnimationFrame(frame);
    await w.__rrvideoClock.advance(35);
    expect(ticks).toBe(3);
    w.clearInterval(interval);
    await w.__rrvideoClock.advance(100);
    expect(ticks).toBe(3);
  });
});
