<script context="module" lang="ts">
  let nextToolbar = 0;
</script>

<script lang="ts">
  const switchId = `rrweb-switch-${++nextToolbar}`;
  import { createEventDispatcher } from 'svelte';
  import TimePill from './TimePill.svelte';
  import Switch from './Switch.svelte';
  import ControlIcon from './ControlIcon.svelte';
  import ControlPopover from './ControlPopover.svelte';
  import type { PlayerFeatures, PlayerControls, PlayerIcons } from '../features';
  export let features: PlayerFeatures = {};
  export let controlVisibility: PlayerControls = {};
  export let icons: PlayerIcons = {};
  export let seconds = 10;
  export let fullscreen = false;
  export let container: HTMLElement;
  export let playing: boolean;
  export let canSkip: boolean;
  export let currentTime: number;
  export let recordingTimeZone: string | undefined = undefined;
  export let startedAt: number;
  export let totalTime: number;
  export let speed: number;
  export let speedOption: number[];
  export let canChangeSpeed: boolean;
  export let annotations: boolean;
  export let skipInactive: boolean;
  export let maxZoom = 4;
  export let zoom = 1;
  export let followCursor = true;
  let zoomControl: ControlPopover;
  export let hasAnnotations: boolean;
  const dispatch = createEventDispatcher();
  let panel: 'speed' | 'zoom' | 'settings' | null = null;
  $: if (
    (panel === 'speed' && controlVisibility.speed === false) ||
    (panel === 'settings' && controlVisibility.settings === false) ||
    (panel === 'zoom' && (features.zoom === false || controlVisibility.zoom === false))
  ) {
    panel = null;
  }
  $: minSpeed = Math.min(0.25, ...speedOption);
  $: maxSpeed = Math.max(8, ...speedOption);
  function changeAnnotations(event: Event) {
    if (event.target instanceof HTMLInputElement) dispatch('annotations', event.target.checked);
  }
  function changeSpeed(value: number) {
    dispatch('speed', Math.max(minSpeed, Math.min(maxSpeed, value)));
  }
  export function fit() {
    followCursor = false;
    zoom = 1;
    panel = null;
    zoomControl?.focus();
  }
</script>

<div class="rr-controller__btns" data-rrweb-part="toolbar" role="group" aria-label="Replay controls">
  {#if controlVisibility.play !== false}
  <button
    type="button"
    data-replay-control
    data-rrweb-control="play"
    aria-label={playing ? 'Pause' : 'Play'}
    title={playing ? 'Pause' : 'Play'}
    on:click={() => dispatch('toggle')}
    ><ControlIcon {icons} name={playing ? 'pause' : 'play'} /></button
  >
  {/if}
  {#if features.jump !== false && controlVisibility.jump !== false}
  <button
    type="button"
    data-replay-control
    data-rrweb-control="jump-back"
    aria-label={`Skip back ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
    title={`Skip back ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
    disabled={!canSkip}
    on:click={() => dispatch('skip', -1)}
    ><ControlIcon {icons} {seconds} name="jump-back" /></button
  >
  {/if}
  {#if features.jump !== false && controlVisibility.jump !== false}
  <button
    type="button"
    data-replay-control
    data-rrweb-control="jump-forward"
    aria-label={`Skip forward ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
    title={`Skip forward ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
    disabled={!canSkip}
    on:click={() => dispatch('skip', 1)}
    ><ControlIcon {icons} {seconds} name="jump-forward" /></button
  >
  {/if}
  {#if controlVisibility.time !== false}
  <TimePill {container} {currentTime} {totalTime} {startedAt} {recordingTimeZone} />
  {/if}
  <div class="rr-control-spacer" />
  {#if controlVisibility.speed !== false}
  <ControlPopover {icons}
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
        disabled={!canChangeSpeed || speed <= minSpeed}
        on:click={() => changeSpeed(speed - 0.25)}>−</button
      >
      <input
        type="range"
        min={minSpeed}
        max={maxSpeed}
        step="any"
        value={speed}
        disabled={!canChangeSpeed}
        aria-label="Playback speed"
        aria-valuetext={`${speed.toFixed(2)} times`}
        on:input={(event) => changeSpeed(Number(event.currentTarget.value))}
      />
      <button
        type="button"
        aria-label="Increase playback speed"
        disabled={!canChangeSpeed || speed >= maxSpeed}
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
            disabled={!canChangeSpeed}
            on:click={() => changeSpeed(value)}
            ><span class:normal={value === 1}
              >{Number.isInteger(value) ? value.toFixed(1) : value}</span
            ></button
          >{#if value === 1}<small>Normal</small>{/if}
        </div>
      {/each}
    </div>
  </ControlPopover>
  {/if}
  {#if features.zoom !== false && controlVisibility.zoom !== false}
  <ControlPopover {icons}
    label="Zoom"
    icon="zoom"
    {container}
    bind:this={zoomControl}
    bind:active={panel}
  >
    <p class="rr-control-value">
      {zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}
    </p>
    <div class="rr-control-range">
      <button
        type="button"
        aria-label="Fit replay to window"
        on:click={() => { followCursor = false; zoom = 1; }}>Fit</button
      >
      <input
        type="range"
        min="100"
        max={maxZoom * 100}
        step="any"
        value={zoom * 100}
        aria-label="Replay zoom"
        aria-valuetext={zoom === 1
          ? 'Fit to window'
          : `${Math.round(zoom * 100)}% of fitted size`}
        on:input={(event) => (zoom = Number(event.currentTarget.value) / 100)}
      />
      <span>{Math.round(zoom * 100)}%</span>
    </div>
    {#if features.zoom?.allowFollow !== false}
    <label for={switchId + '-follow-cursor'} class="rr-setting rr-follow-setting">
      <span>Follow cursor</span>
      <Switch id={switchId + '-follow-cursor'} label="Follow cursor" bind:checked={followCursor} />
    </label>
    {/if}
    <p class="rr-control-hint">
      {features.zoom && features.zoom.pan === false ? '' : 'Drag the replay to reposition. '}Escape returns to Fit.
    </p>
  </ControlPopover>
  {/if}
  {#if controlVisibility.settings !== false}
  <ControlPopover {icons}
    label="Replay settings"
    icon="settings"
    {container}
    bind:active={panel}
  >
    {#if hasAnnotations}
    <label for={switchId + '-annotations'} class="rr-setting"
      ><span>Annotations<small>Captions and timeline notes</small></span><Switch id={switchId + '-annotations'} label="Annotations"
        checked={annotations}
        on:change={changeAnnotations}
      /></label
    >
    {/if}
    <label for={switchId + '-skip-inactive'} class="rr-setting"
      ><span>Skip inactive</span><Switch id={switchId + '-skip-inactive'} label="Skip inactive"
        bind:checked={skipInactive}
      /></label
    >
  </ControlPopover>
  {/if}
  {#if features.fullscreen !== false && controlVisibility.fullscreen !== false}
  <button
    type="button"
    data-replay-control
    data-rrweb-control="fullscreen"
    aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
    title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
    on:click={() => dispatch('fullscreen')}
    ><ControlIcon {icons} name={fullscreen ? 'exit-fullscreen' : 'enter-fullscreen'} /></button
  >
  {/if}
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
    color: var(--rrweb-player-text, var(--rr-theme-text, #edf1ff));
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
    outline: 2px solid var(--rrweb-player-focus-ring, var(--rr-theme-focus-ring, #ffe373));
    outline-offset: 2px;
  }
  .rr-controller__btns :global(button:disabled) {
    opacity: 0.35;
    cursor: not-allowed;
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
    accent-color: var(--rrweb-player-accent, var(--rr-theme-accent, #ffe373));
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
    background: var(--rrweb-player-selected, var(--rr-theme-selected, var(--rrweb-player-accent, var(--rr-theme-accent, #ffffff40))));
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
  .rr-follow-setting {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #ffffff33;
  }
  @container (max-width: 440px) {
    .rr-controller__btns {
      gap: 0;
      padding-inline: 8px;
    }
    .rr-controller__btns :global(button[data-replay-control]) {
      width: 30px;
    }
  }
</style>
