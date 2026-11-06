import type { CheckDefinition } from '../harness.ts';

declare global {
  interface Window {
    /** Set by the fixture server's page: the other origin's base URL. */
    __prerelease_cross_origin?: string;
  }
}

const snapshotBasic: CheckDefinition = {
  id: 'snapshot-basic',
  kind: 'functional',
  tier: 'focused',
  async run(ctx) {
    document.body.innerHTML = '<main><h1>hello</h1><ul><li>1</li></ul></main>';
    const recording = ctx.record();
    await ctx.nextFrame();
    // An empty li, so the mutation carries exactly one added node.
    document.querySelector('ul')!.appendChild(document.createElement('li'));
    const events = await recording.stop();

    if (!events.some((e) => e.type === 2)) {
      return { ok: false, message: 'no FullSnapshot event', events };
    }
    const addedLi = events.some(
      (e) =>
        e.type === 3 &&
        e.data.source === 0 &&
        e.data.adds.length === 1 &&
        e.data.adds[0].node.type === 2 &&
        e.data.adds[0].node.tagName === 'li',
    );
    if (!addedLi) {
      return {
        ok: false,
        message: 'no Mutation event adding exactly one li',
        events,
      };
    }
    const replayed = (await ctx.replay(events)).querySelectorAll('li').length;
    if (replayed !== 2) {
      return {
        ok: false,
        message: `replay has ${replayed} li elements, expected 2`,
        events,
      };
    }
    return { ok: true, events };
  },
};

const shadowDomOpen: CheckDefinition = {
  id: 'shadow-dom-open',
  kind: 'functional',
  tier: 'focused',
  async run(ctx) {
    document.body.innerHTML = '<div id="host"></div>';
    const root = document
      .querySelector('#host')!
      .attachShadow({ mode: 'open' });
    root.innerHTML = '<p>before</p>';
    const text = ctx.control('shadow');
    const recording = ctx.record();
    await ctx.nextFrame();
    const added = document.createElement('p');
    added.className = 'added';
    added.textContent = text;
    root.appendChild(added);
    const events = await recording.stop();

    const mutation = events.some(
      (e) =>
        e.type === 3 /* IncrementalSnapshot */ &&
        e.data.source === 0 /* Mutation */ &&
        JSON.stringify(e.data.adds).includes(text),
    );
    if (!mutation) {
      return {
        ok: false,
        message: 'no Mutation event adding the shadow root text',
        events,
      };
    }
    const replayedRoot = (await ctx.replay(events)).querySelector(
      '#host',
    )?.shadowRoot;
    const replayed = replayedRoot?.querySelector('.added')?.textContent;
    if (replayed !== text) {
      return {
        ok: false,
        message: `replayed shadow root text is ${JSON.stringify(replayed)}`,
        events,
      };
    }
    return { ok: true, events };
  },
};

const customElementsCheck: CheckDefinition = {
  id: 'custom-elements',
  kind: 'functional',
  tier: 'full',
  async run(ctx) {
    document.body.innerHTML = '<x-widget></x-widget>';
    const text = ctx.control('widget');
    const recording = ctx.record();
    await ctx.nextFrame();
    // Defined after record(), so the define call is observed and the
    // upgrade renders a child that the mutation observer sees.
    customElements.define(
      'x-widget',
      class extends HTMLElement {
        connectedCallback() {
          const span = document.createElement('span');
          span.className = 'rendered';
          span.textContent = text;
          this.appendChild(span);
        }
      },
    );
    const events = await recording.stop();

    const defined = events.some(
      (e) =>
        e.type === 3 /* IncrementalSnapshot */ &&
        e.data.source === 16 /* CustomElement */ &&
        e.data.define?.name === 'x-widget',
    );
    if (!defined) {
      return {
        ok: false,
        message: 'no CustomElement event defining x-widget',
        events,
      };
    }
    const replayed = (await ctx.replay(events)).querySelector(
      'x-widget .rendered',
    )?.textContent;
    if (replayed !== text) {
      return {
        ok: false,
        message: `replayed x-widget child text is ${JSON.stringify(replayed)}`,
        events,
      };
    }
    return { ok: true, events };
  },
};

const iframeSameOrigin: CheckDefinition = {
  id: 'iframe-same-origin',
  kind: 'functional',
  tier: 'focused',
  async run(ctx) {
    const frame = document.createElement('iframe');
    frame.srcdoc = '<!doctype html><p id="inner">old</p>';
    const loaded = new Promise<void>((resolve) =>
      frame.addEventListener('load', () => resolve(), { once: true }),
    );
    document.body.appendChild(frame);
    await loaded;
    const recording = ctx.record();
    await ctx.nextFrame();
    const text = ctx.control('inner');
    frame.contentDocument!.querySelector('#inner')!.textContent = text;
    const events = await recording.stop();

    const replayedFrame = (await ctx.replay(events)).querySelector('iframe');
    const replayed =
      replayedFrame?.contentDocument?.querySelector('#inner')?.textContent;
    if (replayed !== text) {
      return {
        ok: false,
        message: `replayed iframe text is ${JSON.stringify(replayed)}`,
        events,
      };
    }
    return { ok: true, events };
  },
};

const iframeCrossOrigin: CheckDefinition = {
  id: 'iframe-cross-origin',
  kind: 'functional',
  tier: 'full',
  needsHttp: true,
  async run(ctx) {
    const crossOrigin = window.__prerelease_cross_origin;
    if (!crossOrigin)
      throw new Error('the fixture server gave no cross origin');
    const text = ctx.control('child');
    // The child's events arrive by postMessage once its page has loaded, so
    // watch the parent's events until the control string shows up.
    let seen = false;
    const recording = ctx.record({
      recordCrossOriginIframes: true,
      emit(event) {
        if (JSON.stringify(event).includes(text)) seen = true;
      },
    });
    const frame = document.createElement('iframe');
    // Base64, so the parent's own record of the iframe src cannot contain the
    // control string; only the child's events can.
    frame.src = `${crossOrigin}/frame/iframe-cross-origin?c=${encodeURIComponent(
      btoa(text),
    )}`;
    document.body.appendChild(frame);

    const deadline = Date.now() + 5_000;
    while (!seen && Date.now() < deadline) await ctx.sleep(100);
    const events = await recording.stop();
    if (!seen) {
      return {
        ok: false,
        message: 'the parent events never contained the child control string',
        events,
      };
    }
    return { ok: true, events };
  },
};

const dialogTopLayer: CheckDefinition = {
  id: 'dialog-top-layer',
  kind: 'functional',
  tier: 'full',
  async run(ctx) {
    document.body.innerHTML = '<dialog id="d"><p>modal</p></dialog>';
    const dialog = document.querySelector<HTMLDialogElement>('#d')!;
    const recording = ctx.record();
    await ctx.nextFrame();
    dialog.showModal();
    const events = await recording.stop();

    const opened = events.some(
      (e) =>
        e.type === 3 /* IncrementalSnapshot */ &&
        e.data.source === 0 /* Mutation */ &&
        e.data.attributes.some((a) => 'open' in a.attributes),
    );
    if (!opened) {
      return {
        ok: false,
        message: 'no Mutation event setting the open attribute',
        events,
      };
    }
    return { ok: true, events };
  },
};

/** A small seeded PRNG, so every run builds the same tree. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The document-order sequence of tagName#id for everything under body. */
function nodeSequence(doc: Document): string {
  return [...doc.body.querySelectorAll('*')]
    .map((el) => `${el.tagName.toLowerCase()}#${el.id}`)
    .join(' ');
}

const nodeOrderBurst: CheckDefinition = {
  id: 'node-order-burst',
  kind: 'functional',
  tier: 'focused',
  async run(ctx) {
    document.body.innerHTML = '<div id="n0"></div>';
    const random = mulberry32(1690);
    const tags = ['div', 'span', 'p', 'section', 'ul'];
    const nodes: Element[] = [document.getElementById('n0')!];
    const recording = ctx.record();
    await ctx.nextFrame();
    // 500 nodes in 10 microtask batches. Each goes to a random existing
    // parent at a random position, so siblings are added in a different
    // order than they end up in.
    for (let batch = 0; batch < 10; batch++) {
      for (let i = 0; i < 50; i++) {
        const el = document.createElement(
          tags[Math.floor(random() * tags.length)],
        );
        el.id = `n${nodes.length}`;
        const parent = nodes[Math.floor(random() * nodes.length)];
        const before =
          parent.children[
            Math.floor(random() * (parent.children.length + 1))
          ] ?? null;
        parent.insertBefore(el, before);
        nodes.push(el);
      }
      await Promise.resolve();
    }
    const live = nodeSequence(document);
    const events = await recording.stop();

    const replayed = nodeSequence(await ctx.replay(events));
    if (replayed !== live) {
      const liveItems = live.split(' ');
      const replayedItems = replayed.split(' ');
      const at = liveItems.findIndex((item, i) => item !== replayedItems[i]);
      return {
        ok: false,
        message: `replayed order differs from live at position ${at}: live ${liveItems[at]}, replay ${replayedItems[at]} (${replayedItems.length} of ${liveItems.length} nodes replayed)`,
        events,
      };
    }
    return { ok: true, events };
  },
};

export const domChecks: CheckDefinition[] = [
  snapshotBasic,
  shadowDomOpen,
  customElementsCheck,
  iframeSameOrigin,
  iframeCrossOrigin,
  dialogTopLayer,
  nodeOrderBurst,
];
