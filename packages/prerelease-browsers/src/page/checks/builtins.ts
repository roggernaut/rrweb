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
    const recording = ctx.record({ recordCanvas: true });
    await ctx.nextFrame();
    const events = await recording.stop();
    if (!events.some((e) => e.type === 2 /* FullSnapshot */)) {
      return { ok: false, message: 'no FullSnapshot event', events };
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
    document.body.innerHTML = '<p class="m">grouped</p>';
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
    return { ok: true, events };
  },
};

export const builtinChecks: CheckDefinition[] = [
  patchedMutationObserver,
  missingWebglTypes,
  missingCssGroupingRule,
];
