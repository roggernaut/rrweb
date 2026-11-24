<script lang="ts">
  import {createEventDispatcher, onDestroy, onMount} from 'svelte';
  import type {Replayer} from '@rrweb/replay';
  import {followReplayCursor} from '../cursor-camera';
  export let frame: HTMLElement;
  export let replay: HTMLElement;
  export let replayer: Replayer;
  export let zoom = 1;
  export let followCursor = true;
  const dispatch = createEventDispatcher();
  let pan = {x:0, y:0};
  let surface: HTMLButtonElement;
  let press: {id:number; x:number; y:number; lastX:number; lastY:number} | null = null;
  let dragged = false;
  let stopFollowing: (()=>void) | undefined;
  function clamp(point: typeof pan) {
    const rect = replay.getBoundingClientRect();
    const x = zoom === 1 ? 0 : Math.max(0,(rect.width - frame.clientWidth)/2);
    const y = zoom === 1 ? 0 : Math.max(0,(rect.height - frame.clientHeight)/2);
    return {x: Math.max(-x, Math.min(x,point.x)), y: Math.max(-y,Math.min(y,point.y))};
  }
  function paint(point: typeof pan) {
    pan = clamp(point);
    replay.style.translate = `${pan.x}px ${pan.y}px`;
  }
  function sync(value: number, follow: boolean) {
    stopFollowing?.();
    replay.style.scale = String(value);
    paint(pan);
    stopFollowing = follow && value > 1 ? followReplayCursor(frame,replay,replayer,()=>pan,paint,clamp) : undefined;
  }
  $: sync(zoom,followCursor);
  onMount(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => paint(pan));
    observer.observe(frame); observer.observe(replay);
    return () => observer.disconnect();
  });
  onDestroy(() => {
    stopFollowing?.();
    replay.style.removeProperty('scale');
    replay.style.removeProperty('translate');
  });
  function down(e: PointerEvent) {
    if (e.button !== 0 || !e.isPrimary) return;
    dragged = false;
    press = {id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY};
    if (zoom > 1) {
      surface.focus();
      surface.setPointerCapture(e.pointerId);
    }
  }
  function move(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    if (!dragged && Math.hypot(e.clientX-press.x,e.clientY-press.y) <= 5) return;
    dragged = true;
    if (zoom > 1) {
      followCursor = false;
      paint({x:pan.x+e.clientX-press.lastX,y:pan.y+e.clientY-press.lastY});
    }
    press.lastX=e.clientX; press.lastY=e.clientY;
  }
  function end(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    if (e.type === 'pointerup') move(e);
    else dragged = true;
    press = null;
    if (surface.hasPointerCapture?.(e.pointerId)) surface.releasePointerCapture(e.pointerId);
  }
  function keydown(e: KeyboardEvent) {
    if (e.key === 'Home') { e.preventDefault(); dispatch('fit'); return; }
    if (zoom <= 1 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const delta = {ArrowLeft:[50,0],ArrowRight:[-50,0],ArrowUp:[0,50],ArrowDown:[0,-50]}[e.key];
    if (!delta) return;
    e.preventDefault(); followCursor = false;
    paint({x:pan.x+delta[0],y:pan.y+delta[1]});
  }
</script>
<button type="button" class="rr-player__surface" class:zoomed={zoom > 1} bind:this={surface}
  aria-label="Play or pause replay" on:pointerdown={down} on:pointermove={move}
  on:pointerup={end} on:pointercancel={end} on:lostpointercapture={end}
  on:keydown={keydown} on:click={e => { if (!e.detail || !dragged) dispatch('toggle'); }} />
<style>
  .rr-player__surface {position:absolute;inset:0;width:100%;height:100%;padding:0;background:transparent;border:0;cursor:pointer;}
  .zoomed {cursor:grab;touch-action:none;user-select:none;}
  .zoomed:active {cursor:grabbing;}
</style>
