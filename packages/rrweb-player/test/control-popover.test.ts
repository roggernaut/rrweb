// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import ControlPopover from '../src/components/ControlPopover.svelte';

let popover: ControlPopover | undefined;

async function mount() {
  const container = document.createElement('div');
  const external = document.createElement('button');
  const sibling = document.createElement('button');
  document.body.append(external, container);
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
  });
}

afterEach(() => {
  popover?.$destroy();
  document.body.replaceChildren();
});

describe('native control popover focus', () => {
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
});
