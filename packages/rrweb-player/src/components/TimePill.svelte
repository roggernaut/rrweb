<script context="module" lang="ts">
  let nextId = 0;

  function formatStart(timestamp: number, timeZone?: string) {
    if (!timeZone || !Number.isFinite(timestamp)) return null;
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone, year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
      }).format(timestamp);
    } catch {
      return null;
    }
  }
</script>

<script lang="ts">
  import { formatTime } from '../utils';
  import { onDestroy } from 'svelte';

  export let currentTime: number;
  export let totalTime: number;
  export let startedAt: number;
  export let recordingTimeZone: string | undefined = undefined;
  export let container: HTMLElement;

  const id = `rrweb-recording-start-${++nextId}`;
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  $: viewerStart = formatStart(startedAt, viewerZone);
  $: userStart = formatStart(startedAt, recordingTimeZone);

  let trigger: HTMLElement;
  let open = false;
  let focused = false;
  let hovered = false;
  let timer: ReturnType<typeof setTimeout>;
  let left = 0, bottom = 0, width = 0;

  function position() {
    const frame = container.getBoundingClientRect();
    const pill = trigger.getBoundingClientRect();
    const scale = frame.width / container.offsetWidth || 1;
    width = Math.max(0, Math.min(236, container.clientWidth - 16));
    left = Math.max(8, Math.min((pill.left + pill.width / 2 - frame.left) / scale - width / 2, container.clientWidth - width - 8));
    bottom = (frame.bottom - pill.top) / scale + 8;
  }

  function show() {
    clearTimeout(timer);
    position();
    open = true;
  }
  function scheduleClose() {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!focused && !hovered) open = false; }, 150);
  }
  function observe(_node: HTMLElement) {
    const observer = new ResizeObserver(position);
    observer.observe(container);
    const row = trigger.parentElement;
    row?.addEventListener('scroll', position);
    return { destroy() { observer.disconnect(); row?.removeEventListener('scroll', position); } };
  }
  onDestroy(() => clearTimeout(timer));
</script>

<svelte:document on:keydown={(e) => { if (open && e.key === 'Escape') open = false; }} />
<!-- The timer is focusable so keyboard users can read its description. -->
<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<div class="rr-time-pill" data-rrweb-part="time" data-replay-time role="timer" aria-label="Replay time"
  bind:this={trigger} tabindex={viewerStart || userStart ? 0 : undefined} aria-describedby={open ? id : undefined}
  on:pointerenter={() => { hovered = true; show(); }} on:pointerleave={() => { hovered = false; scheduleClose(); }}
  on:focus={() => { focused = true; show(); }} on:blur={() => { focused = false; scheduleClose(); }}>
  <span class="rr-timeline__time">{formatTime(Math.max(0, currentTime))}</span>
  / <span class="rr-timeline__time">{formatTime(totalTime)}</span>
</div>
{#if open && (viewerStart || userStart)}
  <div {id} role="tooltip" class="rr-start-tooltip" data-rrweb-part="time-tooltip" use:observe
    style:left={left+'px'} style:bottom={bottom+'px'} style:width={width+'px'}
    on:pointerenter={() => { hovered = true; clearTimeout(timer); }}
    on:pointerleave={() => { hovered = false; scheduleClose(); }}>
    <strong>Recording started</strong>
    <dl>
      {#if userStart}<dt>Recorded user’s local time</dt><dd>{userStart} · {recordingTimeZone}</dd>{/if}
      {#if viewerStart}<dt>Your local time</dt><dd>{viewerStart} · {viewerZone}</dd>{/if}
    </dl>
  </div>
{/if}

<style>
  .rr-time-pill { display:flex; flex-shrink:0; gap:4px; padding:4px 8px; border-radius:999px; background:#ffffff1a; white-space:nowrap; font-size:11px; font-variant-numeric:tabular-nums; }
  .rr-time-pill:focus-visible { outline:2px solid var(--rrweb-player-focus-ring,var(--rr-theme-focus-ring,#ffe373)); outline-offset:2px; }
  @container (max-width:440px) { .rr-time-pill { padding:4px; } }
  .rr-start-tooltip { position:absolute; z-index:50; box-sizing:border-box; padding:10px 12px; border:1px solid var(--rr-theme-panel-border,#ffffff26); border-radius:8px; background:var(--rrweb-player-popover,var(--rr-theme-popover,#101827dd)); color:inherit; backdrop-filter:blur(24px); box-shadow:0 8px 24px #0002; overflow-wrap:anywhere; }
  dl, dd { margin:0; }
  dt { margin-top:8px; font-size:11px; opacity:.8; }
  dd { font-variant-numeric:tabular-nums; }
</style>
