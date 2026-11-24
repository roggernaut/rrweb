<script lang="ts">
  export let name:
    | 'play'
    | 'pause'
    | 'back'
    | 'forward'
    | 'speed'
    | 'zoom'
    | 'settings'
    | 'activity'
    | 'fullscreen';
</script>

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
  {:else if name === 'back' || name === 'forward'}
    <g
      transform={name === 'forward' ? 'translate(24 0) scale(-1 1)' : undefined}
    >
      <path d="M3 9a9 9 0 1 1 0 6M3 3v6h6" />
    </g>
    <text
      x="12"
      y="15"
      text-anchor="middle"
      stroke="none"
      fill="currentColor"
      font-size="8"
      font-weight="600">10</text
    >
  {:else if name === 'speed'}
    <circle cx="12" cy="14" r="8" /><path d="M9 2h6M12 6V2m6 5 2-2m-8 9 3-4" />
  {:else if name === 'activity'}
    <path d="M3 19h18M3 15l4-5 4 3 5-9 5 5" />
  {:else if name === 'zoom'}
    <circle cx="10.5" cy="10.5" r="7" /><path
      d="m16 16 5 5M7.5 10.5h6m-3-3v6"
    />
  {:else if name === 'settings'}
    <path
      d="m10 3-1 3-3 1-3-1-2 4 2 2-1 3 2 3 3-1 3 2 1 3h4l1-3 3-2 3 1 2-3-1-3 2-2-2-4-3 1-3-1-1-3Z"
      transform="translate(1 1) scale(.9)"
    /><circle cx="12" cy="12" r="3" />
  {:else}
    <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
  {/if}
</svg>
