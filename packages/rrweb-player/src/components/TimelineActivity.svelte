<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  import { ACTIVITY_LAYERS } from '../timeline-activity';
  import type {activitySamples, clickMarks} from '../timeline-activity';
  import type {ReplayTimelineScale} from '../timeline-scale';
  import { formatTime } from '../utils';
  export let seekable = true;
  export let scale: ReplayTimelineScale;
  export let samples: ReturnType<typeof activitySamples>;
  export let marks: ReturnType<typeof clickMarks>;
  export let layers: Record<'clicks' | 'mouse' | 'scroll' | 'inputs',boolean>;
  export let currentTime: number;
  export let bottomHovered: boolean;
  let choice: number | null = null;
  $: if (!seekable) choice = null;
  const dispatch = createEventDispatcher<{seek:number}>();
  const round = (value:number) => Number(value.toFixed(3));
  function paths(points: typeof samples, enabled: typeof layers) {
    const top = (point: typeof samples[number], count:number) => {
      let sum = 0;
      for (let i=0;i<count;i++) if (enabled[ACTIVITY_LAYERS[i]]) sum += point.layers[i];
      return round(100-94*sum);
    };
    return ACTIVITY_LAYERS.map((key,i) => {
      if (!enabled[key] || !points.some((point) => point.layers[i] > 0)) return '';
      const edge = (n:number) => points.map(p=>round(p.position*1000)+','+top(p,n));
      return 'M'+edge(i+1).join(' L')+' L'+edge(i).reverse().join(' L')+' Z';
    });
  }
  $: bands = paths(samples,layers);
  function key(event: KeyboardEvent) {
    if (!seekable || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const from = choice ?? currentTime;
    const step = event.shiftKey ? 5000 : 1000;
    const next = {
      ArrowLeft: from - step,
      ArrowRight: from + step,
      Home: 0,
      End: scale.total,
    }[event.key];
    if (event.key === 'Escape' && choice !== null) {
      choice = null;
      event.stopPropagation();
      return;
    }
    if (next === undefined) return;
    event.stopPropagation();
    event.preventDefault();
    choice = Math.max(0, Math.min(scale.total, next));
  }
  function click(event: MouseEvent) {
    if (!seekable) return;
    let time = choice;
    if (event.detail) {
      const rect = (event.currentTarget as Element).getBoundingClientRect();
      if (!rect.width) return;
      time = scale.positionToTime((event.clientX - rect.left) / rect.width);
    }
    if (time === null) return;
    choice = null;
    dispatch('seek', time);
  }
</script>
<button type="button" disabled={!seekable} data-rrweb-part="activity" class="rr-activity" class:shown={bottomHovered}
  aria-label={!seekable ? 'Replay activity' : choice === null ? 'Seek on activity graph' : `Seek to ${formatTime(choice)} on activity graph`}
  title={seekable ? 'Use arrows to choose a time and Enter to seek' : undefined}
  on:click|stopPropagation={click} on:keydown={key} on:blur={() => choice = null}>
  <svg aria-hidden="true" viewBox="0 0 1000 110" preserveAspectRatio="none">
    {#each bands as path, i}
      {#if path}<path d={path} fill={`var(--rrweb-player-activity-${ACTIVITY_LAYERS[i]}, white)`} fill-opacity={[0.17,0.36,0.65][i]} />{/if}
    {/each}
    {#if layers.clicks}
      {#each marks as mark}
        <line x1={1000*mark.from} x2={1000*mark.to+0.001} y1="106" y2="106" stroke="var(--rrweb-player-activity-clicks, var(--rrweb-player-activity-click, white))" stroke-width="4" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      {/each}
    {/if}
    {#if choice !== null}
      <line x1={1000*scale.timeToPosition(choice)} x2={1000*scale.timeToPosition(choice)} y1="0" y2="110" stroke="white" stroke-dasharray="4 3" />
    {/if}
  </svg>
</button>
<style>
  .rr-activity {position:absolute;bottom:100%;left:0;width:100%;height:clamp(30px,8vh,80px);margin:0;padding:0;border:0;background:linear-gradient(transparent,rgba(10,19,37,.78));opacity:0;pointer-events:none;transition:opacity .15s;cursor:crosshair;}
  .rr-activity.shown,
  .rr-activity:focus-visible,
  :global(.rr-progress:focus-within) .rr-activity {
    opacity: 1;
  }
  .rr-activity.shown:not(:disabled),
  .rr-activity:focus-visible:not(:disabled),
  :global(.rr-progress:focus-within) .rr-activity:not(:disabled) {
    pointer-events: auto;
  }
  .rr-activity svg {display:block;width:100%;height:100%;}
  @media (prefers-reduced-motion:reduce){.rr-activity{transition:none;}}
</style>
