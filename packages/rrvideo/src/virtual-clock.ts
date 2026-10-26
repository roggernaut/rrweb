/**
 * In-page virtual clock for frame-exact capture.
 *
 * The replayer's Timer runs on `requestAnimationFrame` + `performance.now`,
 * and rrweb-player / the replayer schedule work with `setTimeout`. Replacing
 * those with a clock that only moves when the capture loop calls
 * `__rrvideoClock.advance(ms)` lets the replayer play normally while each
 * output frame takes however long it takes to render and encode. The player
 * never catches up on wall-clock time, so output length does not depend on
 * CPU load.
 *
 * `Date` is left on the real clock: the replayer only reads it for live mode
 * and for a 500ms guard against unresolvable mutation trees, which must keep
 * working.
 *
 * Exported as a function so it can be inlined into the replay HTML with
 * `Function.prototype.toString`; it must not reference anything outside its
 * own body.
 */
export function installVirtualClock(): void {
  type Callback = (...args: unknown[]) => void;
  type TimerEntry = {
    due: number;
    seq: number;
    interval: number | null;
    callback: Callback;
    args: unknown[];
  };

  const w = window as unknown as Record<string, unknown>;
  const realPerformanceNow = performance.now.bind(performance);
  const realSetTimeout = window.setTimeout.bind(window);

  let now = realPerformanceNow();
  let nextId = 1;
  const timers = new Map<number, TimerEntry>();
  let animationFrames = new Map<number, FrameRequestCallback>();

  function toCallback(handler: TimerHandler): Callback {
    if (typeof handler === 'function') return handler as Callback;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function(String(handler)) as Callback;
  }

  function addTimer(
    handler: TimerHandler,
    delay: unknown,
    args: unknown[],
    repeat: boolean,
  ): number {
    const id = nextId++;
    const ms = Math.max(0, Number(delay) || 0);
    timers.set(id, {
      due: now + ms,
      seq: id,
      // A 0ms interval would spin advance() forever.
      interval: repeat ? Math.max(1, ms) : null,
      callback: toCallback(handler),
      args,
    });
    return id;
  }

  function nextDueTimer(limit: number): [number, TimerEntry] | null {
    let found: [number, TimerEntry] | null = null;
    for (const [id, entry] of timers) {
      if (entry.due > limit) continue;
      if (
        !found ||
        entry.due < found[1].due ||
        (entry.due === found[1].due && entry.seq < found[1].seq)
      ) {
        found = [id, entry];
      }
    }
    return found;
  }

  function report(error: unknown) {
    // Surface errors the way the browser would for a real task.
    realSetTimeout(() => {
      throw error;
    });
  }

  performance.now = () => now;
  w.setTimeout = (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
    addTimer(handler, delay, args, false);
  w.setInterval = (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
    addTimer(handler, delay, args, true);
  w.clearTimeout = w.clearInterval = (id?: number) => {
    if (id !== undefined) timers.delete(id);
  };
  w.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const id = nextId++;
    animationFrames.set(id, callback);
    return id;
  };
  w.cancelAnimationFrame = (id: number) => {
    animationFrames.delete(id);
  };

  w.__rrvideoClock = {
    /**
     * Run every timer due within the next `ms`, in due order, then one round
     * of animation frames at the new time. Yields a microtask between
     * callbacks so promise continuations run in the order they would between
     * real tasks. (Plain promises rather than async/await: this function is
     * inlined via toString and must not depend on compiler helpers.)
     */
    advance(ms: number): Promise<void> {
      const target = now + ms;
      let remaining = 100_000;
      const runAnimationFrames = () => {
        now = target;
        const frames = animationFrames;
        animationFrames = new Map();
        frames.forEach((callback) => {
          try {
            callback(now);
          } catch (error) {
            report(error);
          }
        });
      };
      const step = (): Promise<void> => {
        const next = remaining-- > 0 ? nextDueTimer(target) : null;
        if (!next) {
          runAnimationFrames();
          return Promise.resolve();
        }
        const [id, entry] = next;
        now = Math.max(now, entry.due);
        if (entry.interval === null) timers.delete(id);
        else entry.due += entry.interval;
        try {
          entry.callback(...entry.args);
        } catch (error) {
          report(error);
        }
        return Promise.resolve().then(step);
      };
      return step();
    },
    /** Wall-clock setTimeout, for waiting on real work such as image loads. */
    realSetTimeout,
  };
}
