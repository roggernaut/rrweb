<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { PlayerIcons } from '../features';
  export let icons: PlayerIcons = {};
  import ControlIcon from './ControlIcon.svelte';

  export let label: string;
  export let icon: 'speed' | 'settings' | 'activity';
  export let active: 'speed' | 'settings' | 'activity' | null = null;
  $: open = active === icon;
  function setOpen(value: boolean) {
    if (value) active = icon;
    else if (active === icon) active = null;
  }
  export let container: HTMLElement;
  let trigger: HTMLButtonElement;
  let panel: HTMLDivElement;
  let pinned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let left = 16;
  let bottom = 48;
  let width = 256;
  let maxHeight = 240;

  export function focus() {
    trigger?.focus();
  }
  function getActiveElement() {
    return (trigger?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement;
  }
  function cancelClose() {
    clearTimeout(timer);
  }
  function openOnHover(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    const focusedPanel = getActiveElement()?.closest(
      '[data-replay-control-panel]',
    );
    if (
      focusedPanel &&
      focusedPanel !== panel &&
      trigger.parentElement?.contains(focusedPanel)
    )
      return;
    cancelClose();
    setOpen(true);
  }
  function scheduleClose() {
    cancelClose();
    timer = setTimeout(() => {
      if (!pinned && !panel?.contains(getActiveElement() ?? null)) setOpen(false);
    }, 180);
  }
  function position() {
    if (!container || !trigger) return;
    const frame = container.getBoundingClientRect();
    const button = trigger.getBoundingClientRect();
    const scale = frame.width / container.offsetWidth || 1;
    width = Math.max(0, Math.min(256, container.clientWidth - 32));
    const center = (button.left + button.width / 2 - frame.left) / scale;
    left = Math.max(
      16,
      Math.min(center - width / 2, container.clientWidth - 16 - width),
    );
    bottom = container.clientHeight - (button.top - frame.top) / scale + 8;
    maxHeight = Math.max(0, container.clientHeight - bottom - 16);
  }
  function observe(_node: HTMLElement) {
    position();
    const observer = new ResizeObserver(position);
    observer.observe(container);
    observer.observe(trigger);
    const toolbar = trigger.parentElement;
    toolbar?.addEventListener('scroll', position);
    return {
      destroy: () => {
        observer.disconnect();
        toolbar?.removeEventListener('scroll', position);
      },
    };
  }
  async function click() {
    cancelClose();
    if (open && pinned) {
      if (panel?.contains(getActiveElement() ?? null)) trigger.focus();
      setOpen(false);
      return;
    }
    pinned = true;
    setOpen(true);
    await tick();
    panel?.focus();
  }
  function outside(event: PointerEvent) {
    if (!open) return;
    const path = event.composedPath();
    if (!path.includes(trigger) && !path.includes(panel)) setOpen(false);
  }
  function closeOnBlur(event: FocusEvent) {
    const next = event.relatedTarget;
    if (
      !(next instanceof Node) ||
      (!panel?.contains(next) && !trigger.contains(next))
    )
      setOpen(false);
  }
  function escape(event: KeyboardEvent) {
    if (!open || event.key !== 'Escape' || event.defaultPrevented) return;
    const activeElement = getActiveElement();
    const focusInPanel = panel?.contains(activeElement ?? null);
    if (focusInPanel || activeElement === trigger) event.preventDefault();
    if (focusInPanel) trigger.focus();
    setOpen(false);
  }
  $: if (!open) {
    pinned = false;
    cancelClose();
  }
  onDestroy(cancelClose);
</script>

<svelte:document on:pointerdown={outside} on:keydown={escape} />
<button
  type="button"
  data-replay-control data-rrweb-control={icon}
  bind:this={trigger}
  aria-label={label}
  aria-haspopup="dialog"
  aria-expanded={open}
  class:active={open}
  on:pointerenter={openOnHover}
  on:pointerleave={scheduleClose}
  on:click={click}
  on:focusout={closeOnBlur}
>
  <ControlIcon {icons} name={icon} />
</button>
{#if open}
  <div
    class="rr-control-panel" data-rrweb-part="popover"
    data-replay-control-panel
    bind:this={panel}
    use:observe
    role="dialog"
    aria-label={label}
    tabindex="-1"
    style:left={`${left}px`}
    style:bottom={`${bottom}px`}
    style:width={`${width}px`}
    style:max-height={`${maxHeight}px`}
    on:pointerenter={cancelClose}
    on:pointerleave={scheduleClose}
    on:focusout={closeOnBlur}
  >
    <h3>{label}</h3>
    <div class="rr-control-panel__body"><slot /></div>
  </div>
{/if}

<style>
  .rr-control-panel {
    position: absolute;
    z-index: 50;
    box-sizing: border-box;
    overflow-y: auto;
    border: 1px solid var(--rrweb-player-border, #d8d9e7);
    border-radius: var(--rrweb-player-popover-radius, 8px);
    background: var(--rrweb-player-popover, var(--rrweb-player-surface, rgb(255 255 255 / 97%)));
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    color: var(--rrweb-player-text, #11103e);
    box-shadow: var(--rrweb-player-popover-shadow, 0 8px 24px #11103e24);
    font: var(--rrweb-player-font, 12px/1.5 system-ui, sans-serif);
    text-align: left;
  }
  h3 {
    margin: 0;
    padding: 8px 12px;
    border-bottom: 1px solid var(--rrweb-player-divider, #dadbe5);
    font-size: 12px;
    font-weight: 600;
  }
  .rr-control-panel__body {
    padding: 12px;
  }
</style>
