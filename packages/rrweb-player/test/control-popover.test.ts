// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import ControlPopover from '../src/components/ControlPopover.svelte';

let popover: ControlPopover | undefined;

async function mount(root?: ShadowRoot) {
  const container = document.createElement('div');
  const external = document.createElement('button');
  const sibling = document.createElement('button');
  (root ?? document.body).append(external, container);
  popover = new ControlPopover({
    target: container,
    props: { container, label: 'Playback speed', icon: 'speed' },
  });
  container.append(sibling);
  await tick();
  const trigger = container.querySelector<HTMLButtonElement>(
    '[data-replay-control]',
  )!;
  const panel = () => container.querySelector<HTMLElement>('[role="dialog"]');
  return { external, sibling, trigger, panel };
}

function escape() {
  return new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    composed: true,
  });
}

afterEach(() => {
  popover?.$destroy();
  document.body.replaceChildren();
});

describe('native control popover focus', () => {
  it('keeps interaction and Escape focus within an embedded shadow root', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const { trigger, panel } = await mount(root);
    trigger.click();
    await tick();
    const dialog = panel()!;
    expect(root.activeElement).toBe(dialog);

    dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    await tick();
    expect(panel()).toBe(dialog);
    expect(dialog.dispatchEvent(escape())).toBe(false);
    await tick();
    expect(panel()).toBeNull();
    expect(root.activeElement).toBe(trigger);
  });

  it('dismisses a hover popup without consuming Escape or moving outside focus', async () => {
    const { external, trigger, panel } = await mount();
    external.focus();
    trigger.dispatchEvent(
      new PointerEvent('pointerenter', { pointerType: 'mouse' }),
    );
    await tick();
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(external);

    expect(external.dispatchEvent(escape())).toBe(true);
    await tick();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(external);
  });

  it('lets a previously handled Escape retain focus ownership', async () => {
    const { trigger, panel } = await mount();
    trigger.click();
    await tick();
    const dialog = panel()!;
    expect(document.activeElement).toBe(dialog);

    const handled = escape();
    handled.preventDefault();
    dialog.dispatchEvent(handled);
    await tick();
    expect(panel()).toBe(dialog);
    expect(document.activeElement).toBe(dialog);

    dialog.dispatchEvent(escape());
    await tick();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes a pinned popup when focus moves from the panel through the trigger', async () => {
    const { sibling, trigger, panel } = await mount();
    trigger.click();
    await tick();
    expect(document.activeElement).toBe(panel());
    trigger.focus();
    await tick();
    expect(panel()).not.toBeNull();

    sibling.focus();
    await tick();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(sibling);
  });

  it('handles Escape from the trigger without moving its focus', async () => {
    const { trigger, panel } = await mount();
    trigger.click();
    await tick();
    trigger.focus();
    await tick();
    expect(panel()).not.toBeNull();

    expect(trigger.dispatchEvent(escape())).toBe(false);
    await tick();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
