<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Replayer } from '@rrweb/replay';
  import { unpack } from '@rrweb/packer/unpack';
  import type { eventWithTime } from '@rrweb/types';
  import {
    inlineCss,
    openFullscreen,
    exitFullscreen,
    isFullscreen,
    onFullscreenChange,
    typeOf,
  } from './utils';
  import ZoomPan from './components/ZoomPan.svelte';
  import Controller from './Controller.svelte';
  import type { RRwebPlayerOptions, RRwebPlayerExpose } from './types';
    
  export let width: NonNullable<RRwebPlayerOptions['props']['width']>  = 1024;
  export let height: NonNullable<RRwebPlayerOptions['props']['height']> = 576;
  export let maxScale: NonNullable<RRwebPlayerOptions['props']['maxScale']> = 1;
  export let events: RRwebPlayerOptions['props']['events'];
  export let skipInactive: NonNullable<RRwebPlayerOptions['props']['skipInactive']> = true;
  export let autoPlay: NonNullable<RRwebPlayerOptions['props']['autoPlay']> = true;
  export let speedOption: NonNullable<RRwebPlayerOptions['props']['speedOption']> = [1, 2, 4, 8];
  export let speed: NonNullable<RRwebPlayerOptions['props']['speed']> = 1;
  export let showController: NonNullable<RRwebPlayerOptions['props']['showController']> = true;
  export let showCaptions: NonNullable<RRwebPlayerOptions['props']['showCaptions']> = true;
  export let timelineMarkerColor: NonNullable<RRwebPlayerOptions['props']['timelineMarkerColor']> = 'rgb(73, 80, 246)';
  export let tags: NonNullable<RRwebPlayerOptions['props']['tags']> = {};
  // color of inactive periods indicator
  export let inactiveColor: NonNullable<RRwebPlayerOptions['props']['inactiveColor']> = '#D4D4D4';

  let replayer: Replayer;
  let skipping = false;
  const showSkip = () => { skipping = true; };
  const hideSkip = () => { skipping = false; };
  let captionText: string | undefined;

  export const getMirror = () => replayer.getMirror();

  const controllerHeight = 80;
  let player: HTMLElement;
  let frame: HTMLElement;
  let zoom = 1;
  let followCursor = true;
  function fit() { controller?.fit(); }
  function escape(event: KeyboardEvent) {
    if (event.key === 'Escape' && zoom !== 1 && player?.contains(event.target as Node)) {
      event.preventDefault();
      fit();
    }
  }
  let fullscreenListener: undefined | (() => void);
  let embeddedSize: {width: number; height: number} | null = null;
  let fullscreenObserver: ResizeObserver | undefined;
  let controller: {
    toggle: () => void;
    setSpeed: (speed: number) => void;
    toggleSkipInactive: () => void;
  } & Controller;

  let style: string;
  $: style = inlineCss({
    width: `${width}px`,
    height: `${height}px`,
  });
  let playerStyle: string;
  $: playerStyle = inlineCss({
    width: `${width}px`,
    height: `${height + (showController ? controllerHeight : 0)}px`,
  });

  const updateScale = (
    el: HTMLElement,
    frameDimension: { width: number; height: number },
  ) => {
    const widthScale = width / frameDimension.width;
    const heightScale = height / frameDimension.height;
    const scale = [widthScale, heightScale];
    if (maxScale) scale.push(maxScale);
    el.style.transform =
      `scale(${Math.min(...scale)})` + 'translate(-50%, -50%)';
  };

  export const triggerResize: RRwebPlayerExpose['triggerResize'] = () => {
    updateScale(replayer.wrapper, {
      width: replayer.iframe.offsetWidth,
      height: replayer.iframe.offsetHeight,
    });
  };

  export const toggleFullscreen: RRwebPlayerExpose['toggleFullscreen'] = () => {
    if (player) {
      isFullscreen() ? exitFullscreen() : openFullscreen(player);
    }
  };

  export const addEventListener: RRwebPlayerExpose['addEventListener'] = (
    event: string,
    handler: (detail: unknown) => unknown,
  ) => {
    replayer.on(event, handler);
    switch (event) {
      case 'ui-update-current-time':
      case 'ui-update-progress':
      case 'ui-update-player-state':
        controller.$on(event, ({ detail }) => handler(detail));
      default:
        break;
    }
  };

  export const addEvent: RRwebPlayerExpose['addEvent'] = (event: eventWithTime) => {
    replayer.addEvent(event);
    void controller.triggerUpdateMeta();
  };
  export const getMetaData: RRwebPlayerExpose['getMetaData'] = () => replayer.getMetaData();
  export const getReplayer: RRwebPlayerExpose['getReplayer'] = () => replayer;

  // by pass controller methods as public API
  export const toggle: RRwebPlayerExpose['toggle'] = () => {
    controller.toggle();
  };
  export const setSpeed: RRwebPlayerExpose['setSpeed'] = (speed: number) => {
    controller.setSpeed(speed);
  };
  export const toggleSkipInactive: RRwebPlayerExpose['toggleSkipInactive'] = () => {
    controller.toggleSkipInactive();
  };
  export const play: RRwebPlayerExpose['play'] = () => {
    controller.play();
  };
  export const pause: RRwebPlayerExpose['pause'] = () => {
    controller.pause();
  };
  export const goto: RRwebPlayerExpose['goto'] = (timeOffset: number, play?: boolean) => {
    controller.goto(timeOffset, play);
  };
  export const playRange: RRwebPlayerExpose['playRange'] = (
    timeOffset: number,
    endTimeOffset: number,
    startLooping = false,
    afterHook: undefined | (() => void) = undefined,
  ) => {
    controller.playRange(timeOffset, endTimeOffset, startLooping, afterHook);
  };

  onMount(() => {
    // runtime type check
    if (speedOption !== undefined && typeOf(speedOption) !== 'array') {
      throw new Error('speedOption must be array');
    }
    speedOption.forEach((item) => {
      if (typeOf(item) !== 'number') {
        throw new Error('item of speedOption must be number');
      }
    });
    if (speedOption.indexOf(speed) < 0) {
      throw new Error(`speed must be one of speedOption,
        current config:
        {
          ...
          speed: ${speed},
          speedOption: [${speedOption.toString()}]
          ...
        }
        `);
    }

    replayer = new Replayer(events, {
      speed,
      root: frame,
      unpackFn: unpack,
      ...$$props,
    });

    replayer.on('skip-start', showSkip);
    replayer.on('skip-end', hideSkip);
    replayer.on('resize', (dimension) => {
      updateScale(
        replayer.wrapper,
        dimension as { width: number; height: number },
      );
    });

    fullscreenListener = onFullscreenChange(() => {
      const owner = document.fullscreenElement ?? (document as Document & {webkitFullscreenElement?: Element}).webkitFullscreenElement;
      if (owner === player) {
        embeddedSize ??= {width, height};
        const resize = () => {
          width = player.clientWidth;
          height = Math.max(1, player.clientHeight - (showController ? controllerHeight : 0));
          triggerResize();
        };
        resize();
        if (typeof ResizeObserver !== 'undefined') {
          fullscreenObserver?.disconnect();
          fullscreenObserver = new ResizeObserver(resize);
          fullscreenObserver.observe(player);
        }
      } else if (embeddedSize) {
        fullscreenObserver?.disconnect();
        ({width, height} = embeddedSize);
        embeddedSize = null;
        triggerResize();
      }
    });
  });

  onDestroy(() => {
    fullscreenObserver?.disconnect();
    replayer?.off('skip-start', showSkip);
    replayer?.off('skip-end', hideSkip);
    fullscreenListener && fullscreenListener();
  });
</script>

<style global>
  @import '@rrweb/replay/dist/style.css';

  .rr-player {
    position: relative;
    background: white;
    float: left;
    border-radius: 5px;
    box-shadow: 0 24px 48px rgba(17, 16, 62, 0.12);
  }

  .rr-player:fullscreen {
    width: 100vw !important;
    height: 100vh !important;
    border-radius: 0;
    background: #0a1325;
  }
  .rr-player { container-type: inline-size; }
  .rr-player__viewport {
    position: relative;
  }

  .rr-player__skip-indicator {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 15%);
    color: white;
    font: 32px/1 system-ui, sans-serif;
    pointer-events: none;
  }

  .rr-player__caption {
    bottom: 24px;
    position: absolute;
    left: 8%;
    right: 8%;
    margin: 0 auto;
    width: fit-content;
    max-width: 84%;
    max-height: 45%;
    overflow-y: auto;
    box-sizing: border-box;
    padding: 10px 16px;
    border-radius: 6px;
    background: rgba(24, 29, 40, 0.94);
    color: #fff;
    font: 16px/1.5 system-ui, sans-serif;
    text-align: center;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .rr-player__frame {
    overflow: hidden;
  }

  .replayer-wrapper {
    float: left;
    clear: both;
    transform-origin: top left;
    left: 50%;
    top: 50%;
  }

  .replayer-wrapper > iframe {
    border: none;
  }
</style>

<svelte:window on:keydown|capture={escape} />
<div
  class="rr-player"
  bind:this={player}
  style={playerStyle}
  style:--rr-timeline-marker-panel-width={`${Math.min(280, width * 0.7)}px`}
  style:--rr-timeline-marker-panel-height={`${Math.max(48, height - 32)}px`}
>
  <div class="rr-player__viewport" {style}>
    <div class="rr-player__frame" bind:this={frame} {style} />
    {#if showController && replayer}
      <ZoomPan {frame} replay={replayer.wrapper} {replayer} {zoom} bind:followCursor
        on:fit={fit} on:toggle={toggle} />
    {/if}
    {#if showController && skipping}
      <div class="rr-player__skip-indicator" aria-hidden="true">⏩︎</div>
    {/if}
    <div role="status" aria-live="polite" aria-atomic="true">
      {#if captionText !== undefined}
        <div class="rr-player__caption">{captionText}</div>
      {/if}
    </div>
  </div>
  {#if replayer}
    <Controller
      bind:this={controller}
      {replayer}
      bind:zoom bind:followCursor
      container={player}
      {speed}
      bind:captionText
      bind:showCaptions
      {showController}
      {autoPlay}
      {speedOption}
      {skipInactive}
      {tags}
      {timelineMarkerColor}
      {inactiveColor}
      on:fullscreen={() => toggleFullscreen()}
    />
  {/if}
</div>
