import type { CheckDefinition, Probe } from '../harness.ts';
import type { Tier } from '../../types.ts';

/**
 * A check whose page is plain markup plus one stylesheet, recorded from the
 * full snapshot and compared against the replay.
 */
function staticStyleCheck(spec: {
  id: string;
  tier: Tier;
  css: string;
  html: string;
  probes: Probe[];
}): CheckDefinition {
  return {
    id: spec.id,
    kind: 'functional',
    tier: spec.tier,
    async run(ctx) {
      const style = document.createElement('style');
      style.textContent = spec.css;
      document.head.appendChild(style);
      document.body.innerHTML = spec.html;
      const recording = ctx.record();
      await ctx.nextFrame();
      const events = await recording.stop();
      return ctx.compareComputed(events, spec.probes);
    },
  };
}

const shorthandRoundtrip = staticStyleCheck({
  id: 'css-shorthand-roundtrip',
  tier: 'focused',
  css: '.box{background:#c00 url(data:image/gif;base64,R0lGODlhAQABAAAAACw=) no-repeat;margin:1px 2px}',
  html: '<div class="box">box</div>',
  probes: [
    {
      selector: '.box',
      props: [
        'background-color',
        'background-repeat',
        'margin-left',
        'margin-top',
      ],
    },
  ],
});

const selectorColonEscape = staticStyleCheck({
  id: 'css-selector-colon-escape',
  tier: 'full',
  css: '.a\\:b{color:rgb(0,128,0)}',
  html: '<p class="a:b">escaped</p>',
  probes: [{ selector: '.a\\:b', props: ['color'] }],
});

const gridTemplateAreas = staticStyleCheck({
  id: 'css-grid-template-areas',
  tier: 'full',
  css: '.g{display:grid;grid-template-areas:"a b" "c d"}',
  html: '<div class="g"><span>a</span><span>b</span></div>',
  probes: [{ selector: '.g', props: ['grid-template-areas'] }],
});

const nestedRules = staticStyleCheck({
  id: 'css-nested-rules',
  tier: 'full',
  css: '.n{color:rgb(7,8,9); & .c{color:rgb(10,11,12)}}',
  html: '<div class="n">outer<span class="c">inner</span></div>',
  probes: [{ selector: '.n .c', props: ['color'] }],
});

const earlyLinkedStylesheet: CheckDefinition = {
  id: 'css-early-linked-stylesheet',
  kind: 'functional',
  tier: 'full',
  needsHttp: true,
  async run(ctx) {
    // A link in the composed head would block the scripts until it loaded.
    // Inserting it here, then recording at once, makes it pending when rrweb
    // takes the full snapshot.
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/assets/slow.css';
    document.head.appendChild(link);
    const recording = ctx.record({ recordAfter: 'DOMContentLoaded' });
    if (link.sheet !== null) {
      const events = await recording.stop();
      return {
        ok: false,
        message: 'precondition: slow.css already loaded when recording started',
        events,
      };
    }
    const early = document.createElement('div');
    early.id = 'early';
    early.textContent = 'early';
    document.body.appendChild(early);
    const blue = 'rgb(0, 0, 255)';
    const deadline = Date.now() + 10_000;
    while (getComputedStyle(early).color !== blue && Date.now() < deadline) {
      await ctx.sleep(50);
    }
    const events = await recording.stop();
    if (getComputedStyle(early).color !== blue) {
      return {
        ok: false,
        message: 'the linked stylesheet never applied to the live page',
        events,
      };
    }
    return ctx.compareComputed(events, [
      { selector: '#early', props: ['color'] },
    ]);
  },
};

const adoptedStylesheets: CheckDefinition = {
  id: 'css-adopted-stylesheets',
  kind: 'functional',
  tier: 'focused',
  async run(ctx) {
    document.body.innerHTML = '<p class="ad">document</p><div id="host"></div>';
    const docSheet = new CSSStyleSheet();
    docSheet.replaceSync('.ad{color:rgb(1,2,3)}');
    document.adoptedStyleSheets = [docSheet];

    const root = document
      .querySelector('#host')!
      .attachShadow({ mode: 'open' });
    root.innerHTML = '<span class="sh">shadow</span>';
    const shadowSheet = new CSSStyleSheet();
    shadowSheet.replaceSync('.sh{color:rgb(11,22,33)}');
    root.adoptedStyleSheets = [shadowSheet];

    const recording = ctx.record();
    await ctx.nextFrame();
    // Replaced after record(), so the replay must apply the new sheet.
    const replacement = new CSSStyleSheet();
    replacement.replaceSync('.sh{color:rgb(13,14,15)}');
    root.adoptedStyleSheets = [replacement];
    const events = await recording.stop();
    const hasAdoptedEvent = events.some(
      (e) =>
        e.type === 3 /* IncrementalSnapshot */ &&
        e.data.source === 15 /* AdoptedStyleSheet */,
    );
    if (!hasAdoptedEvent) {
      return {
        ok: false,
        message: 'no AdoptedStyleSheet event for the replaced shadow sheet',
        events,
      };
    }
    return ctx.compareComputed(events, [
      { selector: '.ad', props: ['color'] },
      { selector: '.sh', props: ['color'], shadowHost: '#host' },
    ]);
  },
};

const insertRule: CheckDefinition = {
  id: 'css-insert-rule',
  kind: 'functional',
  tier: 'full',
  async run(ctx) {
    const style = document.createElement('style');
    style.textContent = '.base{color:rgb(1,1,1)}';
    document.head.appendChild(style);
    document.body.innerHTML = '<p class="base late">late</p>';
    const recording = ctx.record();
    await ctx.nextFrame();
    const sheet = style.sheet!;
    sheet.insertRule('.late{color:rgb(4,5,6)}', sheet.cssRules.length);
    const events = await recording.stop();
    const hasRuleEvent = events.some(
      (e) =>
        e.type === 3 /* IncrementalSnapshot */ &&
        e.data.source === 8 /* StyleSheetRule */,
    );
    if (!hasRuleEvent) {
      return { ok: false, message: 'no StyleSheetRule event', events };
    }
    return ctx.compareComputed(events, [
      { selector: '.late', props: ['color'] },
    ]);
  },
};

export const cssChecks: CheckDefinition[] = [
  shorthandRoundtrip,
  selectorColonEscape,
  earlyLinkedStylesheet,
  gridTemplateAreas,
  adoptedStylesheets,
  insertRule,
  nestedRules,
];
