<script lang="ts">
  import type { playerMetaData } from '@rrweb/types';
  import type {
    Replayer,
    PlayerMachineState,
    SpeedMachineState,
  } from '@rrweb/replay';
  import {
    onMount,
    onDestroy,
    createEventDispatcher,
    afterUpdate,
  } from 'svelte';
  import { formatTime } from './utils';
  import PlayerToolbar from './components/PlayerToolbar.svelte';
  import CustomEventMarker from './components/CustomEventMarker.svelte';
  import { parseAnnotationEvent, getActiveCaption } from './annotations';
  import { createReplayTimelineScale } from './timeline-scale';
  import { createTimelineIndex } from './timeline-index';

  const dispatch = createEventDispatcher();

  export let replayer: Replayer;
  export let container: HTMLElement;
  let pointerSeek = false;
  export let showCaptions = true;
  let showTimelineNotes = true;
  const updateTimeline = createTimelineIndex();
  $: timeline = updateTimeline(replayer.service.state.context.events, replayer.config.inactivePeriodThreshold);
  export let captionText: string | undefined = undefined;
  let activeCaptionText: string | undefined;
  $: captionText = showCaptions ? activeCaptionText : undefined;
  // Index changes and seeks reconcile state; playback updates come from annotation events.
  $: activeCaptionText = resolveCaption(timeline);

  let captionUpdatePending = false;

  function resolveCaption(index: ReturnType<typeof updateTimeline>) {
    captionUpdatePending = false;
    return getActiveCaption(index.captions, Math.max(0, replayer.getCurrentTime()))?.text;
  }

  function restoreCaption(index: ReturnType<typeof updateTimeline>) {
    activeCaptionText = resolveCaption(index);
  }

  function handleAnnotation(event: unknown) {
    const annotation = parseAnnotationEvent(event);
    if (annotation?.type !== 'caption' || captionUpdatePending) return;
    captionUpdatePending = true;
    void Promise.resolve().then(() => {
      if (captionUpdatePending) restoreCaption(timeline);
    });
  }

  function restoreCaptionOnSeek() {
    restoreCaption(timeline);
  }
  let timelineMarkerDismissalVersion = 0;

  function dismissTimelineMarkersOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') timelineMarkerDismissalVersion += 1;
  }
  export let showController: boolean;
  export let autoPlay: boolean;
  export let skipInactive: boolean;
  export let speedOption: number[];
  export let speed = speedOption.length ? speedOption[0] : 1;
  export let tags: Record<string, string> = {};
  export let timelineMarkerColor = 'rgb(73, 80, 246)';
  export let inactiveColor: string;

  let currentTime = 0;
  $: {
    dispatch('ui-update-current-time', { payload: currentTime });
  }
  let timer: number | null = null;
  let playerState: 'playing' | 'paused' | 'live';
  $: {
    dispatch('ui-update-player-state', { payload: playerState });
  }
  let speedState: 'normal' | 'skipping';
  let progress: HTMLElement;
  let progressSlider: HTMLElement;
  let finished: boolean;

  let pauseAt: number | false = false;
  let onPauseHook: (() => unknown) | null = null;
  let loop: {
    start: number;
    end: number;
  } | null = null;

  let meta: playerMetaData;
  $: meta = replayer.getMetaData();
  $: accessibleTime = Math.max(0, Math.min(meta.totalTime, Math.floor(currentTime / 1000) * 1000));
  $: scale = createReplayTimelineScale(timeline.end - timeline.start, [
    ...timeline.periods.map(([a,b]): [number, number] => [a-timeline.start,b-timeline.start]),
    ...(timeline.end - timeline.lastActive > replayer.config.inactivePeriodThreshold
      ? [[timeline.lastActive - timeline.start, timeline.end - timeline.start] as const] : []),
  ]);
  let percentage: string;
  $: {
    const percent = meta.totalTime > 0 ? Math.min(1, currentTime / meta.totalTime) : 0;
    percentage = `${100 * scale.timeToPosition(currentTime)}%`;
    dispatch('ui-update-progress', { payload: percent });
  }
  type CustomEvent = {
    name: string;
    background: string;
    position: string;
    timeOffset: number;
    timelineMarkerText: string | undefined;
  };

  $: customEvents = timeline.markers.map((marker): CustomEvent => ({
    name: marker.tag ?? 'Timeline marker',
    timeOffset: marker.timestamp - timeline.start,
    timelineMarkerText: marker.text,
    background: marker.tag === undefined ? timelineMarkerColor : tags[marker.tag] || 'rgb(73, 80, 246)',
    position: `${scale.timeToPosition(marker.timestamp - timeline.start) * 100}%`,
  }));

  const loopTimer = () => {
    stopTimer();

    function update() {
      currentTime = replayer.getCurrentTime();

      if (pauseAt && currentTime >= pauseAt) {
        if (loop) {
          playRange(loop.start, loop.end, true, undefined);
        } else {
          replayer.pause();
          if (onPauseHook) {
            onPauseHook();
            onPauseHook = null;
          }
        }
      }

      if (currentTime < meta.totalTime) {
        timer = requestAnimationFrame(update);
      }
    }

    timer = requestAnimationFrame(update);
  };

  const stopTimer = () => {
    if (timer) {
      cancelAnimationFrame(timer);
      timer = null;
    }
  };

  export const toggle = () => {
    switch (playerState) {
      case 'playing':
        pause();
        break;
      case 'paused':
        play();
        break;
      default:
        break;
    }
  };

  export const play = () => {
    if (playerState !== 'paused') {
      return;
    }
    if (finished) {
      replayer.play();
      finished = false;
    } else {
      replayer.play(currentTime);
    }
  };

  export const pause = () => {
    if (playerState !== 'playing') {
      return;
    }
    replayer.pause();
    pauseAt = false;
  };

  export const goto = (timeOffset: number, play?: boolean) => {
    currentTime = timeOffset;
    pauseAt = false;
    finished = false;
    const resumePlaying =
      typeof play === 'boolean' ? play : playerState === 'playing';
    if (resumePlaying) {
      replayer.play(timeOffset);
    } else {
      replayer.pause(timeOffset);
    }
  };

  export const playRange = (
    timeOffset: number,
    endTimeOffset: number,
    startLooping = false,
    afterHook: undefined | (() => void) = undefined,
  ) => {
    if (startLooping) {
      loop = {
        start: timeOffset,
        end: endTimeOffset,
      };
    } else {
      loop = null;
    }
    currentTime = timeOffset;
    pauseAt = endTimeOffset;
    onPauseHook = afterHook || null;
    replayer.play(timeOffset);
  };

  let controls: HTMLElement;

  function jump(direction: -1 | 1) {
    const now = Math.max(0, replayer.getCurrentTime());
    goto(Math.max(0, Math.min(meta.totalTime, now + direction * 10000)));
  }

  function handlePageKeydown(event: KeyboardEvent) {
    dismissTimelineMarkersOnEscape(event);
    if (!showController || !controls || event.defaultPrevented || event.isComposing ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    const doc = controls.ownerDocument;
    const target = event.composedPath()[0];
    const surface = controls.closest('.rr-player')?.querySelector('.rr-player__surface');
    if (target !== surface) {
      if (target !== doc.body && target !== doc.documentElement) return;
      if (doc.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      const visible = Array.from(doc.querySelectorAll('.rr-player .rr-controller')).filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
          rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
      });
      if (visible.length !== 1 || visible[0] !== controls) return;
    }
    event.preventDefault();
    jump(event.key === 'ArrowLeft' ? -1 : 1);
  }

  const handleProgressClick = (event: MouseEvent) => {
    if (speedState === 'skipping') {
      return;
    }
    pointerSeek = true;
    progressSlider.focus();
    const progressRect = progress.getBoundingClientRect();
    const x = event.clientX - progressRect.left;
    let percent = x / progressRect.width;
    if (percent < 0) {
      percent = 0;
    } else if (percent > 1) {
      percent = 1;
    }
    const timeOffset = scale.positionToTime(percent);
    goto(timeOffset);
  };

  const handleProgressKeydown = (event: KeyboardEvent) => {
    pointerSeek = false;
    // Ignore marker keys and the slider event bubbling to the progress wrapper.
    if (event.target !== event.currentTarget) return;
    if (speedState === 'skipping') {
      return;
    }
    let timeOffset: number;
    switch (event.key) {
      case 'ArrowLeft':
        timeOffset = currentTime - 5000;
        break;
      case 'ArrowRight':
        timeOffset = currentTime + 5000;
        break;
      case 'Home':
        timeOffset = 0;
        break;
      case 'End':
        timeOffset = meta.totalTime;
        break;
      default:
        return;
    }
    event.preventDefault();
    goto(Math.max(0, Math.min(meta.totalTime, timeOffset)));
  };

  export const setSpeed = (newSpeed: number) => {
    let needFreeze = playerState === 'playing';
    speed = newSpeed;
    if (needFreeze) {
      replayer.pause();
    }
    replayer.setConfig({ speed });
    if (needFreeze) {
      replayer.play(currentTime);
    }
  };

  export const toggleSkipInactive = () => {
    skipInactive = !skipInactive;
  };

  let refreshPending = false;
  let eventCount = replayer.service.state.context.events.length;
  function scheduleTimelineRefresh() {
    if (refreshPending) return;
    refreshPending = true;
    void Promise.resolve().then(() => {
      if (!refreshPending) return;
      refreshPending = false;
      const events = replayer.service.state.context.events;
      eventCount = events.length;
      const nextMeta = replayer.getMetaData();
      if (nextMeta.startTime !== meta.startTime) {
        currentTime = Math.max(0, replayer.getCurrentTime());
      }
      meta = nextMeta;
      timeline = updateTimeline(events, replayer.config.inactivePeriodThreshold);
    });
  }

  function handleStateChange(states: unknown) {
    if (eventCount !== replayer.service.state.context.events.length) {
      scheduleTimelineRefresh();
    }
    const { player, speed } = states as {
      player?: PlayerMachineState;
      speed?: SpeedMachineState;
    };
    if (player?.value && playerState !== player.value) {
      playerState = player.value;
      switch (playerState) {
        case 'playing':
          loopTimer();
          break;
        case 'paused':
          stopTimer();
          break;
        default:
          break;
      }
    }
    if (speed?.value && speedState !== speed.value) {
      speedState = speed.value;
    }
  }

  onMount(() => {
    replayer.on('annotation', handleAnnotation);
    replayer.on('start', restoreCaptionOnSeek);
    playerState = replayer.service.state.value;
    speedState = replayer.speedService.state.value;
    replayer.on('state-change', handleStateChange);
    replayer.on('finish', () => {
      finished = true;
      if (onPauseHook) {
        onPauseHook();
        onPauseHook = null;
      }
    });

    if (autoPlay) {
      replayer.play();
    }
  });

  afterUpdate(() => {
    if (skipInactive !== replayer.config.skipInactive) {
      replayer.setConfig({ skipInactive });
    }
  });

  onDestroy(() => {
    captionUpdatePending = false;
    refreshPending = false;
    replayer.off('annotation', handleAnnotation);
    replayer.off('start', restoreCaptionOnSeek);
    replayer.off('state-change', handleStateChange);
    replayer.pause();
    stopTimer();
  });
</script>

<svelte:window on:keydown={handlePageKeydown} />

{#if showController}
  <div class="rr-controller" bind:this={controls} data-native-replay-controls>
    <div class="rr-timeline">
      <div
        class="rr-progress"
        class:pointer-seek={pointerSeek}
        class:disabled={speedState === 'skipping'}
        bind:this={progress}
        on:click={handleProgressClick}
        on:keydown={handleProgressKeydown}
      >
        <div
          class="rr-progress__slider"
          bind:this={progressSlider}
          role="slider"
          tabindex="0"
          aria-label="Playback position"
          aria-valuemin="0"
          aria-valuemax={Math.floor(meta.totalTime / 1000) * 1000}
          aria-valuenow={accessibleTime}
          aria-valuetext={`${formatTime(accessibleTime)} of ${formatTime(meta.totalTime)}`}
          aria-disabled={speedState === 'skipping'}
          on:keydown={handleProgressKeydown}
          on:blur={() => (pointerSeek = false)}
        />
        <div
          class="rr-progress__step"
          style="width: {percentage}"
        />
        {#each scale.spans.filter(span => span.idle) as span}
          <div title="inactive period" class="rr-inactive-period"
            style:left={`${span.left * 100}%`} style:width={`${(span.right-span.left) * 100}%`}
            style:color={inactiveColor} />
        {/each}
        {#each customEvents as event}
          {#if event.timelineMarkerText}
            {#if showTimelineNotes}
              <CustomEventMarker
                dismissalVersion={timelineMarkerDismissalVersion}
                name={event.name}
                text={event.timelineMarkerText}
                background={event.background}
                position={event.position}
                disabled={speedState === 'skipping'}
                on:seek={() => goto(event.timeOffset)}
                on:focus-timeline={() => progressSlider.focus()}
              />
            {/if}
          {:else}
            <div
              title={event.name}
              style="width: 10px;height: 5px;position: absolute;top:
              2px;transform: translate(-50%, -50%);background: {event.background};left:
              {event.position};"
            />
          {/if}
        {/each}

        <div class="rr-progress__handler" style="left: {percentage}" />
      </div>
    </div>
    <PlayerToolbar
      {container}
      {currentTime}
      totalTime={meta.totalTime}
      playing={playerState === 'playing'}
      canSkip={playerState === 'playing' || playerState === 'paused'}
      hasAnnotations={timeline.hasCaptions || timeline.markers.some(marker => marker.text)}
      {speed}
      {speedOption}
      annotations={showCaptions || showTimelineNotes}
      bind:skipInactive
      on:toggle={toggle}
      on:fullscreen={() => dispatch('fullscreen')}
      on:speed={(event) => setSpeed(event.detail)}
      on:annotations={(event) => {
        showCaptions = event.detail;
        showTimelineNotes = event.detail;
      }}
      on:skip={(event) => jump(event.detail < 0 ? -1 : 1)}
    />
  </div>
{/if}

<style>
  .rr-controller {
    width: 100%;
    height: 80px;
    background: #0a1325;
    color: #edf1ff;
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    align-items: center;
    border-radius: 0 0 5px 5px;
  }

  .rr-inactive-period {
    position: absolute;
    height: 50%;
    top: 25%;
    pointer-events: none;
    background: repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 5px);
  }
  .rr-timeline {
    width: 100%;
    box-sizing: border-box;
    padding: 0 12px;
    display: flex;
    align-items: center;
  }

  .rr-progress {
    flex: 1;
    height: 12px;
    background: #dbe2fd24;
    background-clip: padding-box;
    position: relative;
    border-radius: 3px;
    cursor: pointer;
    box-sizing: border-box;
    border-top: solid 4px transparent;
    border-bottom: solid 4px transparent;
  }

  .rr-progress__slider {
    position: absolute;
    inset: -4px 0;
    pointer-events: none;
    border-radius: 3px;
  }
  .rr-progress:not(.pointer-seek) .rr-progress__slider:focus-visible {
    outline: 2px solid #ffe373;
    outline-offset: 2px;
  }
  .rr-progress.disabled {
    cursor: not-allowed;
  }

  .rr-progress__step {
    height: 100%;
    position: absolute;
    left: 0;
    top: 0;
    background: #eec20266;
  }

  .rr-progress__handler {
    width: 20px;
    height: 20px;
    border-radius: 10px;
    position: absolute;
    top: 2px;
    transform: translate(-50%, -50%);
    background: #eec202;
  }
</style>
