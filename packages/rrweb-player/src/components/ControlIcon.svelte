<script lang="ts">
  import type { PlayerIcons, PlayerIconName } from '../features';
  import IconOverride from './IconOverride.svelte';
  export let name: PlayerIconName;
  export let icons: PlayerIcons = {};
  export let seconds = 10;
  $: jumpLabel = String(seconds);
  $: jumpLabelSize = Math.min(8, 12 / (jumpLabel.length * 0.65));
</script>

<IconOverride {icons} {name} {seconds}>
<svg
  width="18"
  height="18"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'play'}
    <path d="m8 5 11 7-11 7Z" />
  {:else if name === 'pause'}
    <path d="M8 5v14M16 5v14" />
  {:else if name === 'jump-back' || name === 'jump-forward'}
    <g
      transform={name === 'jump-forward' ? 'translate(24 0) scale(-1 1)' : undefined}
    >
      <path d="M3 9a9 9 0 1 1 0 6M3 3v6h6" />
    </g>
    <text
      x="12"
      y="15"
      text-anchor="middle"
      stroke="none"
      fill="currentColor"
      font-size={jumpLabelSize}
      font-weight="600">{jumpLabel}</text
    >
  {:else if name === 'speed'}
    <circle cx="12" cy="14" r="8" /><path d="M9 2h6M12 6V2m6 5 2-2m-8 9 3-4" />
  {:else if name === 'activity'}
    <g stroke-width="2">
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M7 11.207a.5.5 0 0 1 .146-.353l2-2a.5.5 0 0 1 .708 0l3.292 3.292a.5.5 0 0 0 .708 0l4.292-4.292a.5.5 0 0 1 .854.353V16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z" />
    </g>
  {:else if name === 'settings'}
    <g stroke-width="2">
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </g>
  {:else if name === 'exit-fullscreen'}
    <path d="M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5" />
  {:else}
    <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
  {/if}
</svg>
</IconOverride>
