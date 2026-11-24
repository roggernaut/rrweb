<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { formatTime } from '../utils';
  import ControlIcon from './ControlIcon.svelte';
  import ControlPopover from './ControlPopover.svelte';
  export let container: HTMLElement;
  export let playing: boolean;
  export let canSkip: boolean;
  export let currentTime: number;
  export let totalTime: number;
  export let speed: number;
  export let speedOption: number[];
  export let annotations: boolean;
  export let skipInactive: boolean;
  export let hasAnnotations: boolean;
  const dispatch = createEventDispatcher();
  let panel: 'speed' | 'settings' | null = null;
  $: minSpeed = Math.min(0.25, ...speedOption);
  $: maxSpeed = Math.max(8, ...speedOption);
  function changeSpeed(value: number) {
    dispatch('speed', Math.max(minSpeed, Math.min(maxSpeed, value)));
  }
</script>

<div class="rr-controller__btns" role="group" aria-label="Replay controls">
  <button
    type="button"
    data-replay-control
    aria-label={playing ? 'Pause' : 'Play'}
    title={playing ? 'Pause' : 'Play'}
    on:click={() => dispatch('toggle')}
    ><ControlIcon name={playing ? 'pause' : 'play'} /></button
  >
  <button
    type="button"
    data-replay-control
    aria-label="Skip back 10 seconds"
    title="Skip back 10 seconds"
    disabled={!canSkip}
    on:click={() => dispatch('skip', -10000)}
    ><ControlIcon name="back" /></button
  >
  <button
    type="button"
    data-replay-control
    aria-label="Skip forward 10 seconds"
    title="Skip forward 10 seconds"
    disabled={!canSkip}
    on:click={() => dispatch('skip', 10000)}
    ><ControlIcon name="forward" /></button
  >
  <div
    class="rr-time-pill"
    data-replay-time
    role="timer"
    aria-label="Replay time"
  >
    <span class="rr-timeline__time">{formatTime(Math.max(0, currentTime))}</span
    >
    / <span class="rr-timeline__time">{formatTime(totalTime)}</span>
  </div>
  <div class="rr-control-spacer" />
  <ControlPopover
    label="Playback speed"
    icon="speed"
    {container}
    bind:active={panel}
  >
    <p class="rr-control-value" aria-live="polite">{speed.toFixed(2)}×</p>
    <div class="rr-control-range">
      <button
        type="button"
        aria-label="Decrease playback speed"
        disabled={speed <= minSpeed}
        on:click={() => changeSpeed(speed - 0.25)}>−</button
      >
      <input
        type="range"
        min={minSpeed}
        max={maxSpeed}
        step="0.25"
        value={speed}
        aria-label="Playback speed"
        aria-valuetext={`${speed.toFixed(2)} times`}
        on:input={(event) => changeSpeed(Number(event.currentTarget.value))}
      />
      <button
        type="button"
        aria-label="Increase playback speed"
        disabled={speed >= maxSpeed}
        on:click={() => changeSpeed(speed + 0.25)}>+</button
      >
    </div>
    <div class="rr-speed-presets">
      {#each speedOption as value}
        <div>
          <button
            type="button"
            aria-label={`${value}× speed`}
            aria-pressed={speed === value}
                on:click={() => changeSpeed(value)}
            ><span class:normal={value === 1}
              >{Number.isInteger(value) ? value.toFixed(1) : value}</span
            ></button
          >{#if value === 1}<small>Normal</small>{/if}
        </div>
      {/each}
    </div>
  </ControlPopover>
  <ControlPopover
    label="Replay settings"
    icon="settings"
    {container}
    bind:active={panel}
  >
    {#if hasAnnotations}
    <label class="rr-setting"
      ><span>Annotations<small>Captions and timeline notes</small></span><input
        type="checkbox"
        role="switch"
        aria-label="Annotations"
        checked={annotations}
        on:change={(event) =>
          dispatch('annotations', event.currentTarget.checked)}
      /></label
    >
    {/if}
    <label class="rr-setting"
      ><span>Skip inactive</span><input
        type="checkbox"
        role="switch"
        aria-label="Skip inactive"
        bind:checked={skipInactive}
      /></label
    >
  </ControlPopover>
  <button
    type="button"
    data-replay-control
    aria-label="Fullscreen"
    title="Fullscreen"
    on:click={() => dispatch('fullscreen')}
    ><ControlIcon name="fullscreen" /></button
  >
</div>

<style>
  .rr-controller__btns {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    box-sizing: border-box;
    padding: 4px 12px;
    /* Popovers are positioned against an ancestor outside the scrolling row. */
    overflow-x: auto;
    color: #edf1ff;
    font:
      12px/1.5 system-ui,
      sans-serif;
  }
  .rr-controller__btns :global(button) {
    padding: 0;
    border: 0;
    color: inherit;
    font: inherit;
    background: none;
    cursor: pointer;
  }
  .rr-controller__btns :global(button[data-replay-control]) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 8px;
  }
  .rr-controller__btns :global(button:hover),
  .rr-controller__btns :global(button.active) {
    background: #ffffff1a;
  }
  .rr-controller__btns :global(button:focus-visible),
  .rr-controller__btns :global(input:focus-visible) {
    outline: 2px solid #ffe373;
    outline-offset: 2px;
  }
  .rr-controller__btns :global(button:disabled) {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .rr-time-pill {
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 999px;
    background: #ffffff1a;
    white-space: nowrap;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .rr-control-spacer {
    flex: 1;
    min-width: 0;
  }
  .rr-control-value {
    margin: 0 0 4px;
    text-align: center;
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .rr-control-range {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .rr-control-range button {
    min-width: 28px;
    height: 28px;
    border-radius: 999px;
    background: #ffffff1a;
  }
  input[type='range'] {
    min-width: 0;
    flex: 1;
    height: 32px;
    accent-color: #ffe373;
    cursor: pointer;
  }
  .rr-speed-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
    text-align: center;
  }
  .rr-speed-presets div {
    flex: 1;
    min-width: 40px;
  }
  .rr-speed-presets button {
    width: 100%;
    padding: 6px 0;
    background: #ffffff1a;
    border-radius: 999px;
    font-size: 11px;
  }
  .rr-speed-presets button[aria-pressed='true'] {
    background: #ffffff40;
  }
  .normal {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  small {
    display: block;
    margin-top: 4px;
    color: #edf1ffb3;
    font-size: 10px;
  }
  .rr-control-hint {
    margin: 8px 0 0;
    color: #edf1ffb3;
    font-size: 11px;
  }
  .rr-setting {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    cursor: pointer;
  }
  .rr-setting + .rr-setting {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #ffffff1a;
  }
  input[role='switch'] {
    appearance: none;
    width: 36px;
    height: 20px;
    padding: 2px;
    flex-shrink: 0;
    border-radius: 999px;
    background: #ffffff33;
    cursor: pointer;
  }
  input[role='switch']::before {
    content: '';
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
  }
  input[role='switch']:checked {
    background: #d4ad00;
  }
  input[role='switch']:checked::before {
    transform: translateX(16px);
  }
  @container (max-width: 440px) {
    .rr-controller__btns {
      gap: 0;
      padding-inline: 8px;
    }
    .rr-controller__btns :global(button[data-replay-control]) {
      width: 30px;
    }
    .rr-time-pill {
      padding: 4px;
      font-size: 10px;
    }
  }
</style>
