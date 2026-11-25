<script lang="ts">
  export let id: string;
  export let checked: boolean;
  export let disabled = false;
  export let label: string;
</script>
<span class="switch" data-rrweb-part="switch" class:disabled>
  <input {id} type="checkbox" role="switch" aria-label={label} bind:checked {disabled} on:change />
  <span class="track" data-rrweb-part="switch-track" aria-hidden="true"></span>
</span>
<style>
  .switch {
    --width: var(--rrweb-player-switch-width, var(--rr-switch-width, 32px));
    --height: var(--rrweb-player-switch-height, var(--rr-switch-height, 16px));
    --inset: var(--rrweb-player-switch-inset, 0px);
    --thumb: var(--rrweb-player-switch-thumb-size, calc(var(--height) - 2 * var(--inset)));
    position: relative;
    display: inline-flex;
    flex: none;
    width: var(--width);
    height: var(--height);
  }
  .disabled { opacity: .5; }
  input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    cursor: pointer;
    opacity: 0;
  }
  input:disabled { cursor: not-allowed; }
  .track::before, .track::after {
    content: '';
    position: absolute;
    border-radius: 999px;
  }
  .track::before {
    inset: 0;
    background: var(--rrweb-player-switch-off, rgba(73, 80, 246, .5));
    transition: background .1s ease;
  }
  .track::after {
    top: calc((var(--height) - var(--thumb)) / 2);
    left: var(--inset);
    width: var(--thumb);
    height: var(--thumb);
    background: var(--rrweb-player-switch-knob, #fcfff4);
    box-shadow: var(--rrweb-player-switch-shadow, 0 2px 5px #0005);
    transition: transform .15s ease;
  }
  input:checked + .track::before {
    background: var(--rrweb-player-switch-on, var(--rrweb-player-accent, #4950f6));
  }
  input:checked + .track::after {
    transform: translateX(calc(var(--width) - var(--thumb) - 2 * var(--inset)));
  }
  input:focus-visible + .track::before {
    outline: 2px solid var(--rrweb-player-focus-ring, var(--rrweb-player-accent, #4950f6));
    outline-offset: 3px;
  }
  @media (prefers-reduced-motion: reduce) {
    .track::before, .track::after { transition: none; }
  }
</style>
