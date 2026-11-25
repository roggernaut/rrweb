<script lang="ts">
  import type { PlayerIconContext, PlayerIcons, PlayerIconName } from '../features';
  export let icons: PlayerIcons;
  export let name: PlayerIconName;
  export let seconds = 10;

  function draw(host: HTMLElement, artwork: { render: NonNullable<PlayerIcons[PlayerIconName]>; name: PlayerIconName; seconds: number }) {
    function update({ render, name, seconds }: typeof artwork) {
      const context: PlayerIconContext = { name, seconds, document: host.ownerDocument };
      const svg = render(context);
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      host.replaceChildren(svg);
    }
    update(artwork);
    return { update };
  }
  $: render = icons[name];
</script>

{#if render}
  <span aria-hidden="true" data-rrweb-part="icon" use:draw={{ render, name, seconds }} />
{:else}
  <slot />
{/if}

<style>
  span { display: inline-flex; align-items: center; justify-content: center; pointer-events: none; }
</style>
