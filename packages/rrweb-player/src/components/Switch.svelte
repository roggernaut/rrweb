<script lang="ts">
  export let id: string;
  export let checked: boolean;
  export let disabled = false;
  export let label: string;
</script>
<span class="switch" class:disabled>
  <input {id} type="checkbox" role="switch" aria-label={label} bind:checked {disabled} on:change />
  <span class="track" aria-hidden="true"></span>
</span>
<style>
  .switch { position:relative; display:inline-flex; flex:none; width:var(--rr-switch-width,36px); height:var(--rr-switch-height,20px); }
  .disabled { opacity:.5; }
  input { position:absolute; inset:0; z-index:1; width:100%; height:100%; margin:0; cursor:pointer; opacity:0; }
  input:disabled { cursor:not-allowed; }
  .track::before, .track::after { content:''; position:absolute; border-radius:999px; }
  .track::before { inset:0; background:var(--rr-switch-off,#ffffff33); transition:background .1s ease; }
  .track::after { top:var(--rr-switch-inset,2px); left:var(--rr-switch-inset,2px); width:var(--rr-switch-thumb,16px); height:var(--rr-switch-thumb,16px); background:var(--rr-switch-knob,white); box-shadow:var(--rr-switch-shadow,none); transition:transform .15s ease; }
  input:checked + .track::before { background:var(--rrweb-player-accent,var(--rr-theme-accent,#eec202)); }
  input:checked + .track::after { transform:translateX(calc(var(--rr-switch-width,36px) - var(--rr-switch-thumb,16px) - 2 * var(--rr-switch-inset,2px))); }
  input:focus-visible + .track::before { outline:2px solid var(--rrweb-player-focus-ring,var(--rr-theme-focus-ring,#ffe373)); outline-offset:3px; }
  @media (prefers-reduced-motion:reduce) { .track::before, .track::after { transition:none; } }
</style>
