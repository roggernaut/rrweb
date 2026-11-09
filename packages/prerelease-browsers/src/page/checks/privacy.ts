import type { eventWithTime, serializedNodeWithId } from '@rrweb/types';
import type { CheckContext, CheckDefinition } from '../harness.ts';

// Every check plants canaries where rrweb must mask or block, and controls
// in nearby content it must record. Each one changes the page after the
// first snapshot, so the snapshot and the mutation paths are both covered.
// Each also proves the protected content was recorded in its masked form or
// as a placeholder: a recorder that dropped it would leak nothing either.

type Field = HTMLInputElement | HTMLTextAreaElement;

/** Sets a field's value and fires `input`, as typing does. */
function typeInto(field: Field, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function byId<T extends Element = HTMLElement>(
  id: string,
  root: ParentNode = document,
): T {
  const el = root.querySelector(`#${id}`);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

/** A blocked element leaves a placeholder sized by these attributes. */
const blockPlaceholder = (events: eventWithTime[]) =>
  JSON.stringify(events).includes('"rr_width"');

/** Appends a paragraph holding a fresh control, and returns the control. */
function appendControl(ctx: CheckContext, parent: Node, name: string): string {
  const control = ctx.control(name);
  const p = document.createElement('p');
  p.textContent = control;
  parent.appendChild(p);
  return control;
}

const maskAllInputs: CheckDefinition = {
  id: 'privacy-mask-all-inputs',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    // Input element types are covered by privacy-input-types.
    const initial = ctx.canary('textarea');
    const label = ctx.control('label');
    document.body.innerHTML = `<form id="f"><label>${label}</label><textarea id="ta">${initial}</textarea></form>`;
    const recording = ctx.record({ maskAllInputs: true });
    await ctx.nextFrame();
    const typed = ctx.canary('typedtextarea');
    typeInto(byId('ta'), typed);
    const added = appendControl(ctx, byId('f'), 'added');
    const events = await recording.stop();
    return ctx.assertPrivate(events, [initial, typed], [label, added], {
      maskedAs: [initial, typed],
    });
  },
};

const maskTextClass: CheckDefinition = {
  id: 'privacy-mask-text-class',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    const outer = ctx.canary('outer');
    const nested = ctx.canary('nested');
    const control = ctx.control('sibling');
    document.body.innerHTML = `<p class="rr-mask">${outer} <span id="nested">${nested}</span></p><p id="pub">${control}</p>`;
    const recording = ctx.record({ maskTextClass: 'rr-mask' });
    await ctx.nextFrame();
    const replaced = ctx.canary('replaced');
    byId('nested').textContent = replaced;
    const added = appendControl(ctx, document.body, 'added');
    const events = await recording.stop();
    return ctx.assertPrivate(
      events,
      [outer, nested, replaced],
      [control, added],
      { maskedAs: [outer, nested, replaced] },
    );
  },
};

const maskTextSelector: CheckDefinition = {
  id: 'privacy-mask-text-selector',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    const secret = ctx.canary('secret');
    const control = ctx.control('sibling');
    document.body.innerHTML = `<div id="secret" data-secret>${secret}</div><div>${control}</div>`;
    const recording = ctx.record({ maskTextSelector: '[data-secret]' });
    await ctx.nextFrame();
    const changed = ctx.canary('changed');
    (byId('secret').firstChild as Text).data = changed;
    const added = appendControl(ctx, document.body, 'added');
    const events = await recording.stop();
    return ctx.assertPrivate(events, [secret, changed], [control, added], {
      maskedAs: [secret, changed],
    });
  },
};

const blockClass: CheckDefinition = {
  id: 'privacy-block-class',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    const text = ctx.canary('text');
    const value = ctx.canary('value');
    const control = ctx.control('sibling');
    document.body.innerHTML = `<div class="rr-block"><p id="bt">${text}</p><input type="text" id="bi" value="${value}"></div><p id="pub">${control}</p><input type="text" id="open">`;
    const recording = ctx.record({ blockClass: 'rr-block' });
    await ctx.nextFrame();
    const changed = ctx.canary('changed');
    const typed = ctx.canary('typed');
    byId('bt').textContent = changed;
    typeInto(byId('bi'), typed);
    // Typed the same way outside the block, so input events are proven live.
    const openTyped = ctx.control('typed');
    typeInto(byId('open'), openTyped);
    const added = appendControl(ctx, document.body, 'added');
    const events = await recording.stop();
    return ctx.assertPrivate(
      events,
      [text, value, changed, typed],
      [control, added, openTyped],
      { evidence: { 'blocked placeholder': blockPlaceholder(events) } },
    );
  },
};

const blockSelector: CheckDefinition = {
  id: 'privacy-block-selector',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    const text = ctx.canary('text');
    const control = ctx.control('sibling');
    document.body.innerHTML = `<div id="blocked"><p>${text}</p></div><p>${control}</p>`;
    const recording = ctx.record({ blockSelector: '#blocked' });
    await ctx.nextFrame();
    const appended = ctx.canary('appended');
    const p = document.createElement('p');
    p.textContent = appended;
    byId('blocked').appendChild(p);
    const added = appendControl(ctx, document.body, 'added');
    const events = await recording.stop();
    return ctx.assertPrivate(events, [text, appended], [control, added], {
      evidence: { 'blocked placeholder': blockPlaceholder(events) },
    });
  },
};

const passwordDefault: CheckDefinition = {
  id: 'privacy-password-default',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    const initial = ctx.canary('initial');
    const label = ctx.control('label');
    document.body.innerHTML = `<label>${label}</label><input type="password" id="pw" value="${initial}"><input type="text" id="name">`;
    const recording = ctx.record();
    await ctx.nextFrame();
    const typed = ctx.canary('typed');
    const attribute = ctx.canary('attribute');
    const password = byId<HTMLInputElement>('pw');
    typeInto(password, typed);
    password.setAttribute('value', attribute);
    // A text input is not masked by default, so its value must be recorded.
    const name = ctx.control('name');
    typeInto(byId('name'), name);
    const events = await recording.stop();
    return ctx.assertPrivate(
      events,
      [initial, typed, attribute],
      [label, name],
      { maskedAs: [initial, typed, attribute] },
    );
  },
};

const maskInputOptions: CheckDefinition = {
  id: 'privacy-mask-input-options',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    const initialEmail = ctx.canary('email', 'email');
    const initialTel = ctx.canary('tel', 'digits');
    const initialName = ctx.control('initialname');
    document.body.innerHTML = `<input type="email" id="email" value="${initialEmail}"><input type="tel" id="tel" value="${initialTel}"><input type="text" id="name" value="${initialName}">`;
    const recording = ctx.record({
      maskInputOptions: { email: true, tel: true },
    });
    await ctx.nextFrame();
    const typedEmail = ctx.canary('typedemail', 'email');
    const typedTel = ctx.canary('typedtel', 'digits');
    typeInto(byId('email'), typedEmail);
    typeInto(byId('tel'), typedTel);
    // Text inputs are not in maskInputOptions, so this value is recorded.
    const name = ctx.control('name');
    typeInto(byId('name'), name);
    const events = await recording.stop();
    return ctx.assertPrivate(
      events,
      [initialEmail, initialTel, typedEmail, typedTel],
      [initialName, name],
      { maskedAs: [initialEmail, initialTel, typedEmail, typedTel] },
    );
  },
};

const mutationAfterSnapshot: CheckDefinition = {
  id: 'privacy-mutation-after-snapshot',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    document.body.innerHTML =
      '<div id="wrap"><p class="rr-mask" id="m">masked before</p><p id="pub">public before</p></div>';
    const recording = ctx.record({ maskTextClass: 'rr-mask' });
    await ctx.nextFrame();
    const wrap = byId('wrap');
    const masked = byId('m');
    const pub = byId('pub');
    // A text node edited in place, then replaced by a new one.
    const edited = ctx.canary('edited');
    const editedControl = ctx.control('edited');
    (masked.firstChild as Text).data = edited;
    (pub.firstChild as Text).data = editedControl;
    await ctx.nextFrame();
    const replaced = ctx.canary('replaced');
    const replacedControl = ctx.control('replaced');
    masked.textContent = replaced;
    pub.textContent = replacedControl;
    // New masked nodes: one with direct text, one with text in a child.
    const appended = ctx.canary('appended');
    const p = document.createElement('p');
    p.className = 'rr-mask';
    p.textContent = appended;
    wrap.appendChild(p);
    const nested = ctx.canary('nested');
    const div = document.createElement('div');
    div.className = 'rr-mask';
    div.innerHTML = `<span>${nested}</span>`;
    wrap.appendChild(div);
    const added = appendControl(ctx, wrap, 'added');
    const events = await recording.stop();
    return ctx.assertPrivate(
      events,
      [edited, replaced, appended, nested],
      [editedControl, replacedControl, added],
      { maskedAs: [edited, replaced, appended, nested] },
    );
  },
};

const attributeMutation: CheckDefinition = {
  id: 'privacy-attribute-mutation',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    document.body.innerHTML = '<input type="text" id="i"><div id="note"></div>';
    const recording = ctx.record({ maskAllInputs: true });
    await ctx.nextFrame();
    const value = ctx.canary('value');
    byId('i').setAttribute('value', value);
    // An attribute that is never masked, changed the same way.
    const control = ctx.control('note');
    byId('note').setAttribute('data-note', control);
    const events = await recording.stop();
    return ctx.assertPrivate(events, [value], [control], { maskedAs: [value] });
  },
};

const autofill: CheckDefinition = {
  id: 'privacy-autofill',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    document.body.innerHTML =
      '<form><input type="text" id="name" autocomplete="name"><input type="email" id="email" autocomplete="email"></form><p id="pub">public before</p>';
    // Autofill writes the value natively, past rrweb's value setter hook, so
    // take the setter before record() installs that hook.
    const valueProperty = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!;
    const nativeSet = (input: HTMLInputElement, value: string) =>
      valueProperty.set!.call(input, value);
    const recording = ctx.record({ maskAllInputs: true });
    await ctx.nextFrame();
    const name = ctx.canary('name');
    const email = ctx.canary('email', 'email');
    for (const [id, value] of [
      ['name', name],
      ['email', email],
    ]) {
      const input = byId<HTMLInputElement>(id);
      nativeSet(input, value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const control = ctx.control('pub');
    (byId('pub').firstChild as Text).data = control;
    const events = await recording.stop();
    return ctx.assertPrivate(events, [name, email], [control], {
      maskedAs: [name, email],
    });
  },
};

/** An open shadow root holding a masked and a public paragraph. */
function maskedShadowRoot(ctx: CheckContext) {
  const secret = ctx.canary('shadow');
  const control = ctx.control('shadow');
  document.body.innerHTML = '<div id="host"></div>';
  const root = byId('host').attachShadow({ mode: 'open' });
  root.innerHTML = `<p class="rr-mask" id="m">${secret}</p><p id="pub">${control}</p>`;
  return { root, secret, control };
}

/** Changes the masked text and adds a public paragraph, after record(). */
function changeShadowRoot(ctx: CheckContext, root: ShadowRoot) {
  const changed = ctx.canary('changed');
  (byId('m', root).firstChild as Text).data = changed;
  const added = appendControl(ctx, root, 'added');
  return { changed, added };
}

const shadowDom: CheckDefinition = {
  id: 'privacy-shadow-dom',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    const { root, secret, control } = maskedShadowRoot(ctx);
    const recording = ctx.record({ maskTextClass: 'rr-mask' });
    await ctx.nextFrame();
    const { changed, added } = changeShadowRoot(ctx, root);
    const events = await recording.stop();
    return ctx.assertPrivate(events, [secret, changed], [control, added], {
      maskedAs: [secret, changed],
    });
  },
};

const adoptedStylesheetShadow: CheckDefinition = {
  id: 'privacy-adopted-stylesheet-shadow',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    if (!('adoptedStyleSheets' in ShadowRoot.prototype)) {
      return { ok: true, skipped: 'no adopted stylesheets' };
    }
    const { root, secret, control } = maskedShadowRoot(ctx);
    const first = new CSSStyleSheet();
    first.replaceSync('#pub { color: rgb(0, 0, 255); }');
    root.adoptedStyleSheets = [first];
    const recording = ctx.record({ maskTextClass: 'rr-mask' });
    await ctx.nextFrame();
    await ctx.sleep(50); // past the event rrweb emits for the attached sheet
    const { changed, added } = changeShadowRoot(ctx, root);
    // Replaced in the same task as the text change, which is what this check
    // adds over privacy-shadow-dom: masking must hold while it is recorded.
    const next = new CSSStyleSheet();
    next.replaceSync('#pub { color: rgb(0, 128, 0); }');
    root.adoptedStyleSheets = [next];
    const events = await recording.stop();
    return ctx.assertPrivate(events, [secret, changed], [control, added], {
      maskedAs: [secret, changed],
      evidence: {
        'the replaced stylesheet': events.some(
          (e) =>
            e.type === 3 /* IncrementalSnapshot */ &&
            e.data.source === 15 /* AdoptedStyleSheet */ &&
            /rgb\(0,\s*128,\s*0\)/.test(JSON.stringify(e.data)),
        ),
      },
    });
  },
};

/** Input types from `input-types` that accept free text or digits. */
const freeTextTypes: Array<
  [type: string, format: 'text' | 'digits' | 'email']
> = [
  ['text', 'text'],
  ['email', 'email'],
  ['tel', 'digits'],
  ['url', 'text'],
  ['search', 'text'],
  ['number', 'digits'],
];

const inputTypes: CheckDefinition = {
  id: 'privacy-input-types',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    document.body.innerHTML = '<form id="f"></form>';
    const form = byId('f');
    const label = ctx.control('label');
    form.innerHTML = `<label>${label}</label>`;
    const canaries: string[] = [];
    const values: string[] = [];
    // A URL input holds the canary as a path, so the value stays a URL.
    const asValue = (type: string, canary: string) =>
      type === 'url' ? `https://example.com/${canary}` : canary;
    const inputs = freeTextTypes.map(([type, format]) => {
      const input = document.createElement('input');
      input.type = type;
      const canary = ctx.canary(`initial${type}`, format);
      input.setAttribute('value', asValue(type, canary));
      canaries.push(canary);
      values.push(asValue(type, canary));
      form.appendChild(input);
      return input;
    });
    const recording = ctx.record({ maskAllInputs: true });
    await ctx.nextFrame();
    inputs.forEach((input, i) => {
      const [type, format] = freeTextTypes[i];
      const canary = ctx.canary(`typed${type}`, format);
      typeInto(input, asValue(type, canary));
      canaries.push(canary);
      values.push(asValue(type, canary));
    });
    const added = appendControl(ctx, form, 'added');
    const events = await recording.stop();
    return ctx.assertPrivate(events, canaries, [label, added], {
      maskedAs: values,
    });
  },
};

/** The ids of the canvases that CanvasMutation events (source 9) target. */
function canvasMutationIds(events: eventWithTime[]): Set<number> {
  return new Set(
    events.flatMap((e) =>
      e.type === 3 /* IncrementalSnapshot */ &&
      e.data.source === 9 /* CanvasMutation */
        ? [e.data.id]
        : [],
    ),
  );
}

/** Finds the node with this id in the FullSnapshot (type 2) tree. */
function snapshotNode(
  events: eventWithTime[],
  id: number,
): serializedNodeWithId | undefined {
  const full = events.find((e) => e.type === 2 /* FullSnapshot */);
  if (!full || full.type !== 2) return undefined;
  const stack: serializedNodeWithId[] = [full.data.node];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node.id === id) return node;
    if ('childNodes' in node) stack.push(...node.childNodes);
  }
  return undefined;
}

const canvasBlock: CheckDefinition = {
  id: 'privacy-canvas-block',
  kind: 'privacy',
  tier: 'focused',
  async run(ctx) {
    document.body.innerHTML =
      '<canvas id="blocked" class="rr-block" width="64" height="64"></canvas><canvas id="public" width="64" height="64"></canvas>';
    const blocked = byId<HTMLCanvasElement>('blocked');
    const open = byId<HTMLCanvasElement>('public');
    const contexts = [blocked, open].map((c) => {
      const context = c.getContext('2d');
      if (!context) throw new Error('no 2d context');
      return context;
    });
    // Drawn before record(), so the snapshot would carry the pixels.
    for (const context of contexts) {
      context.fillStyle = '#0a0';
      context.fillRect(0, 0, 32, 32);
    }
    const recording = ctx.record({ recordCanvas: true });
    await ctx.nextFrame();
    // rrweb drops the id attribute of a blocked element, so take node ids
    // from the mirror rather than from the serialized attributes.
    const blockedId = ctx.rrweb.record.mirror.getId(blocked);
    const openId = ctx.rrweb.record.mirror.getId(open);
    const start = performance.now();
    for (let frame = 0; performance.now() - start < 500; frame++) {
      for (const context of contexts) {
        context.fillStyle = `hsl(${(frame * 7) % 360} 80% 50%)`;
        context.fillRect(0, 0, 64, 64);
      }
      await ctx.nextFrame();
    }
    const events = await recording.stop();

    const node = snapshotNode(events, blockedId);
    if (!node || node.type !== 2 /* Element */ || node.tagName !== 'canvas') {
      return {
        ok: false,
        message: `blocked canvas (id ${blockedId}) not in the FullSnapshot`,
        events,
      };
    }
    const targeted = canvasMutationIds(events);
    if (targeted.has(blockedId) || 'rr_dataURL' in node.attributes) {
      return {
        ok: false,
        kind: 'privacy',
        message: 'privacy leak: blocked canvas recorded',
        events,
      };
    }
    // Nothing leaked, but the public canvas went unrecorded too: a broken
    // recorder, which is a functional failure, as in assertPrivate.
    if (!targeted.has(openId)) {
      return {
        ok: false,
        kind: 'functional',
        message: 'public control missing: canvas',
        events,
      };
    }
    return { ok: true, events };
  },
};

export const privacyChecks: CheckDefinition[] = [
  maskAllInputs,
  maskTextClass,
  maskTextSelector,
  blockClass,
  blockSelector,
  passwordDefault,
  maskInputOptions,
  mutationAfterSnapshot,
  attributeMutation,
  autofill,
  shadowDom,
  adoptedStylesheetShadow,
  inputTypes,
  canvasBlock,
];
