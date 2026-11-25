<script lang="ts">
  export let checked: boolean;
  export let label: string;
</script>

<style>
  .switch {
    height: 1em;
    display: flex;
    align-items: center;
  }

  .label {
    margin: 0 8px;
  }

  .switch input[type='checkbox'] {
    position: absolute;
    opacity: 0;
  }

  .switch .track {
    width: 2em;
    height: 1em;
    position: relative;
    cursor: pointer;
    display: block;
  }

  .switch .track:before {
    content: '';
    position: absolute;
    width: 2em;
    height: 1em;
    left: 0.1em;
    transition: background 0.1s ease;
    background: rgba(73, 80, 246, 0.5);
    border-radius: 50px;
  }

  .switch .track:after {
    content: '';
    position: absolute;
    width: 1em;
    height: 1em;
    border-radius: 50px;
    left: 0;
    transition: all 0.2s ease;
    box-shadow: 0px 2px 5px 0px rgba(0, 0, 0, 0.3);
    background: #fcfff4;
    animation: switch-off 0.2s ease-out;
    z-index: 2;
  }

  .switch input[type='checkbox']:checked + .track:before {
    background: rgb(73, 80, 246);
  }

  .switch input[type='checkbox']:focus-visible + .track {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }

  .switch input[type='checkbox']:checked + .track:after {
    animation: switch-on 0.2s ease-out;
    left: 1.1em;
  }
</style>

<label class="switch">
  <input type="checkbox" role="switch" bind:checked />
  <span class="track" aria-hidden="true" />
  <span class="label">{label}</span>
</label>
