import type { CheckDefinition } from '../harness.ts';

const patchedMutationObserver: CheckDefinition = {
  id: 'patched-mutation-observer',
  kind: 'functional',
  tier: 'focused',
  beforeRrweb() {
    // Frameworks such as Salesforce LWC replace MutationObserver before any
    // other script runs; rrweb must still reach the native constructor.
    window.MutationObserver = class {
      constructor() {
        throw new Error('MutationObserver was hijacked by framework');
      }
    } as unknown as typeof MutationObserver;
  },
  async run(ctx) {
    document.body.innerHTML = '<ul id="list"><li>a</li></ul>';
    const recording = ctx.record();
    await ctx.nextFrame();
    const list = document.querySelector('#list')!;
    for (const text of ['b', 'c', 'd']) {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    }
    const events = await recording.stop();

    let added = 0;
    for (const e of events) {
      if (e.type === 3 /* IncrementalSnapshot */ && e.data.source === 0) {
        // Mutation
        added += e.data.adds.filter(
          (add) => add.node.type === 2 && add.node.tagName === 'li',
        ).length;
      }
    }
    if (added !== 3) {
      return {
        ok: false,
        message: `Mutation events add ${added} li elements, expected 3`,
        events,
      };
    }
    return { ok: true, events };
  },
};

const taintedInputGetters: CheckDefinition = {
  id: 'tainted-input-getters',
  kind: 'functional',
  tier: 'full',
  beforeRrweb() {
    // Models a Firefox extension content script (rrweb#1950), where the
    // prototypes are Xray wrappers: defineProperty does not merge with the
    // existing descriptor, so a descriptor holding only `set` loses the
    // getter, and redefining the result is silently ignored.
    const define = Object.defineProperty.bind(Object);
    Object.defineProperty = function (
      target: object,
      key: PropertyKey,
      descriptor: PropertyDescriptor,
    ) {
      if (target !== HTMLInputElement.prototype || key !== 'value') {
        return define(target, key, descriptor);
      }
      try {
        define(target, key, {
          get: undefined,
          set: undefined,
          ...descriptor,
          enumerable: false,
          configurable: false,
        });
      } catch {
        // already non-configurable
      }
      return target;
    } as typeof Object.defineProperty;
  },
  async run(ctx) {
    document.body.innerHTML = '<input type="text" id="i">';
    const input = document.querySelector<HTMLInputElement>('#i')!;
    const recording = ctx.record();
    await ctx.nextFrame();
    input.value = 'typed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const events = await recording.stop();

    const id = ctx.rrweb.record.mirror.getId(input);
    const texts = events.flatMap((e) =>
      e.type === 3 /* IncrementalSnapshot */ &&
      e.data.source === 5 /* Input */ &&
      e.data.id === id
        ? [e.data.text]
        : [],
    );
    if (!texts.includes('typed')) {
      return {
        ok: false,
        message: `Input events recorded ${JSON.stringify(
          texts,
        )}, expected "typed"`,
        events,
      };
    }
    return { ok: true, events };
  },
};

const missingWebglTypes: CheckDefinition = {
  id: 'missing-webgl-types',
  kind: 'functional',
  tier: 'full',
  beforeRrweb() {
    // Some embedded webviews and privacy tools remove the WebGL constructors.
    const w = window as unknown as Record<string, unknown>;
    delete w.WebGL2RenderingContext;
    delete w.WebGLRenderingContext;
  },
  async run(ctx) {
    document.body.innerHTML = '<canvas id="c" width="20" height="20"></canvas>';
    const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
    const recording = ctx.record({ recordCanvas: true });
    await ctx.nextFrame();
    // 2d recording must survive the missing WebGL types.
    canvas.getContext('2d')!.fillRect(1, 1, 2, 2);
    const events = await recording.stop();
    if (!events.some((e) => e.type === 2 /* FullSnapshot */)) {
      return { ok: false, message: 'no FullSnapshot event', events };
    }
    const id = ctx.rrweb.record.mirror.getId(canvas);
    const drawn = events.some(
      (e) =>
        e.type === 3 /* IncrementalSnapshot */ &&
        e.data.source === 9 /* CanvasMutation */ &&
        e.data.id === id,
    );
    if (!drawn) {
      return { ok: false, message: 'no CanvasMutation event', events };
    }
    return { ok: true, events };
  },
};

const missingCssGroupingRule: CheckDefinition = {
  id: 'missing-css-grouping-rule',
  kind: 'functional',
  tier: 'full',
  beforeRrweb() {
    delete (window as unknown as Record<string, unknown>).CSSGroupingRule;
  },
  async run(ctx) {
    const style = document.createElement('style');
    style.textContent = '@media screen{.m{color:red}}';
    document.head.appendChild(style);
    document.body.innerHTML = '<p class="m">grouped</p><p class="m2">added</p>';
    const recording = ctx.record();
    await ctx.nextFrame();
    const media = style.sheet!.cssRules[0] as CSSMediaRule;
    media.insertRule('.m2{color:blue}', 0);
    const events = await recording.stop();

    if (!events.some((e) => e.type === 2 /* FullSnapshot */)) {
      return { ok: false, message: 'no FullSnapshot event', events };
    }
    const ruleEvent = events.some(
      (e) =>
        e.type === 3 /* IncrementalSnapshot */ &&
        e.data.source === 8 /* StyleSheetRule */,
    );
    if (!ruleEvent) {
      return { ok: false, message: 'no StyleSheetRule event', events };
    }
    // Not liveMustBe: an insertRule that rrweb's patch broke is rrweb's fault.
    const live = getComputedStyle(document.querySelector('.m2')!).color;
    if (live !== 'rgb(0, 0, 255)') {
      return {
        ok: false,
        message: `insertRule did not reach the live page: .m2 is ${live}`,
        events,
      };
    }
    return ctx.compareComputed(events, [{ selector: '.m2', props: ['color'] }]);
  },
};

export const builtinChecks: CheckDefinition[] = [
  patchedMutationObserver,
  taintedInputGetters,
  missingWebglTypes,
  missingCssGroupingRule,
];
