import type { Replayer } from '@rrweb/replay';
type Point = { x: number; y: number };
export function followReplayCursor(
  frame: HTMLElement,
  replay: HTMLElement,
  replayer: Replayer,
  getPan: () => Point,
  setPan: (p: Point) => void,
  clampPan: (p: Point) => Point,
) {
  const cursor = replay.querySelector<HTMLElement>('.replayer-mouse');
  if (!cursor) return;
  let target = getPan();
  let velocity: Point = { x: 0, y: 0 };
  let animation: number | null = null;
  let lastTime = 0;
  let playing = replayer.service.state.value === 'playing';
  let pausedAt = replayer.getCurrentTime();
  const reducedMotion = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  )?.matches;

  function paint(point: Point) {
    const next = clampPan(point);
    if (next.x !== point.x) velocity.x = 0;
    if (next.y !== point.y) velocity.y = 0;
    setPan(next);
  }

  function animate(time: number) {
    animation = null;
    const seconds = Math.max(0, Math.min(time - lastTime, 64)) / 1000;
    lastTime = time;
    const previous = getPan();
    const distance = Math.hypot(target.x - previous.x, target.y - previous.y);
    if (distance < 0.25 && Math.hypot(velocity.x, velocity.y) < 2) {
      velocity = { x: 0, y: 0 };
      paint(target);
      return;
    }
    // Critically damped spring: continuous velocity through target changes,
    // with gentle acceleration and braking rather than repeated ease restarts.
    // Its speed grows with the distance left, so a cursor that crosses the
    // page is caught within about half a second and never overshot. There
    // is no separate speed limit: a flat one made long moves crawl.
    const frequency = 8;
    const decay = Math.exp(-frequency * seconds);
    const next = { ...previous };
    for (const axis of ['x', 'y'] as const) {
      const offset = previous[axis] - target[axis];
      const impulse = velocity[axis] + frequency * offset;
      next[axis] = target[axis] + (offset + impulse * seconds) * decay;
      velocity[axis] = (velocity[axis] - frequency * impulse * seconds) * decay;
      // A changed goal can be crossed by velocity from the previous goal,
      // even with critical damping. Stop at that goal instead of wobbling.
      if ((previous[axis] - target[axis]) * (next[axis] - target[axis]) <= 0) {
        next[axis] = target[axis];
        velocity[axis] = 0;
      }
    }
    paint(next);
    animation = requestAnimationFrame(animate);
  }

  function follow(snap = false) {
    const left = Number.parseFloat(cursor!.style.left);
    const top = Number.parseFloat(cursor!.style.top);
    if (
      !Number.isFinite(left) ||
      !Number.isFinite(top) ||
      !replay.offsetWidth ||
      !replay.offsetHeight
    )
      return;
    const bounds = replay.getBoundingClientRect();
    const centered = {
      x: ((replay.offsetWidth / 2 - left) * bounds.width) / replay.offsetWidth,
      y:
        ((replay.offsetHeight / 2 - top) * bounds.height) / replay.offsetHeight,
    };
    // Let the cursor roam within the central half. Once it leaves, center
    // only that axis to give it room before the next camera movement.
    const marginX = frame.clientWidth * 0.25;
    const marginY = frame.clientHeight * 0.25;
    target = clampPan({
      x: Math.abs(centered.x - target.x) > marginX ? centered.x : target.x,
      y: Math.abs(centered.y - target.y) > marginY ? centered.y : target.y,
    });
    if (snap || reducedMotion) {
      stopAnimation();
      paint(target);
    } else if (animation === null) {
      lastTime = performance.now();
      animation = requestAnimationFrame(animate);
    }
  }
  function stopAnimation() {
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null;
    velocity = { x: 0, y: 0 };
  }
  function pause() {
    playing = false;
    pausedAt = replayer.getCurrentTime();
    stopAnimation();
  }
  function start() {
    // rrweb emits start after synchronously casting the sought frame, for
    // both play(offset) and pause(offset). A normal resume keeps its framing.
    const sought =
      playing || Math.abs(replayer.getCurrentTime() - pausedAt) > 1;
    playing = true;
    if (sought) {
      stopAnimation();
      target = getPan();
    }
    follow(sought);
  }
  follow(!playing);
  replayer.on('start', start);
  replayer.on('pause', pause);
  replayer.on('finish', pause);
  // Observe the rendered cursor, including seek and iframe-adjusted positions.
  const observer = new MutationObserver(() => {
    if (playing) follow();
  });
  observer.observe(cursor, { attributes: true, attributeFilter: ['style'] });
  const resize = new ResizeObserver(() => follow(!playing));
  resize.observe(frame);
  resize.observe(replay);
  return () => {
    observer.disconnect();
    resize.disconnect();
    replayer.off('start', start);
    replayer.off('pause', pause);
    replayer.off('finish', pause);
    stopAnimation();
  };
}
