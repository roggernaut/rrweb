/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import record from '../../src/record';
import { EventType, IncrementalSource, type eventWithTime } from '@rrweb/types';

describe('record() and a <form> whose tagName is shadowed', () => {
  it('records an attribute mutation on the form without throwing', async () => {
    // Real browsers make a named form control reachable as an own property
    // on its <form> (`<form><input name="tagName">` makes `form.tagName`
    // resolve to the <input>, not the string `'FORM'`). jsdom doesn't
    // implement that quirk, so the shadowing is reproduced directly here,
    // the same way packages/rrweb-snapshot/test/utils.test.ts does for
    // `untaintedTagName` itself.
    document.body.innerHTML = '<form><input name="tagName"></form>';
    const form = document.querySelector('form')!;
    const input = document.querySelector('input')!;
    Object.defineProperty(form, 'tagName', {
      value: input,
      configurable: true,
    });
    // sanity check: the shadowing actually took effect
    expect(typeof form.tagName).not.toBe('string');

    const events: eventWithTime[] = [];
    let uncaught: unknown;
    const onError = (e: ErrorEvent) => {
      uncaught = e.error ?? e.message;
    };
    window.addEventListener('error', onError);

    const stop = record({ emit: (event) => events.push(event) });
    try {
      form.setAttribute('data-x', 'mutated');
      // MutationObserver callbacks run as a microtask; give it a couple of
      // ticks (a macrotask is enough to also drain any queued microtasks).
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      stop?.();
      window.removeEventListener('error', onError);
    }

    expect(uncaught).toBeUndefined();
    const mutationEmitted = events.some(
      (event) =>
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation &&
        event.data.attributes.some(
          (a) =>
            'data-x' in a.attributes && a.attributes['data-x'] === 'mutated',
        ),
    );
    expect(mutationEmitted).toBe(true);
  });
});

/**
 * The mutation path used to decide "is this `value` an input value?" purely by
 * tag name, so a component library's `<ion-input type="password">` -- a custom
 * element, not an INPUT -- recorded its credential raw on every mutation,
 * while the same element masked correctly in a full snapshot. The gate now
 * also asks the element's own `type`/`autocomplete`, but stays
 * `password`-specific so the tags that merely have a `.type` string
 * (`<li type="disc">`, `<ol type="1">`) are not swept back in.
 */
describe('record() value mutations on a custom element that declares a credential', () => {
  class IonInput extends HTMLElement {
    get type(): string | null {
      return this.getAttribute('type');
    }
    get autocomplete(): string | null {
      return this.getAttribute('autocomplete');
    }
  }
  if (!customElements.get('ion-input'))
    customElements.define('ion-input', IonInput);

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** Every `value`/`type` attribute the recorder emitted, in order. */
  async function recordAttributeMutations(
    markup: string,
    drive: (el: HTMLElement) => void,
    privacyPolicy?: Record<string, unknown>,
  ): Promise<string[]> {
    document.body.innerHTML = markup;
    const el = document.querySelector('#t') as HTMLElement;
    const events: eventWithTime[] = [];
    const stop = record({
      emit: (event) => events.push(event),
      ...(privacyPolicy ? { privacyPolicy: privacyPolicy as never } : {}),
    });
    try {
      drive(el);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      stop?.();
    }
    return events.flatMap((event) =>
      event.type === EventType.IncrementalSnapshot &&
      event.data.source === IncrementalSource.Mutation
        ? event.data.attributes.flatMap((a) =>
            ['value', 'type'].flatMap((name) =>
              typeof a.attributes[name] === 'string'
                ? [a.attributes[name] as string]
                : [],
            ),
          )
        : [],
    );
  }

  it('masks a value mutation on <ion-input type="password">', async () => {
    const values = await recordAttributeMutations(
      '<ion-input id="t" type="password" value="old"></ion-input>',
      (el) => el.setAttribute('value', 'hunter2'),
    );
    expect(values).toContain('*******');
    expect(values).not.toContain('hunter2');
  });

  /**
   * The gate also opens for a protected autocomplete token, which is what
   * carries the value to `maskInput` under a managed preset. Under `manual`
   * it still records raw -- `maskInputOptions` has never keyed off
   * `autocomplete`, so that matches pre-v2 behavior rather than regressing
   * it; `isProtectedInput`'s unconditional protection remains INPUT-scoped.
   */
  it('masks one declared by a protected autocomplete token under balanced', async () => {
    const values = await recordAttributeMutations(
      '<ion-input id="t" autocomplete="cc-number" value="old"></ion-input>',
      (el) => el.setAttribute('value', '4111111111111111'),
      { version: 1, preset: 'balanced' },
    );
    expect(values).not.toContain('4111111111111111');
  });

  it("leaves a plain custom element's value alone", async () => {
    const values = await recordAttributeMutations(
      '<ion-input id="t" type="text" value="old"></ion-input>',
      (el) => el.setAttribute('value', 'plain text'),
    );
    expect(values).toContain('plain text');
  });

  it('does not re-mask <li value> under balanced', async () => {
    const values = await recordAttributeMutations(
      '<ol><li id="t" value="3">x</li></ol>',
      (el) => el.setAttribute('value', '7'),
      { version: 1, preset: 'balanced' },
    );
    expect(values).toContain('7');
  });

  it('leaves <ol type="1"> unaffected', async () => {
    const values = await recordAttributeMutations(
      '<ol id="t" type="1"><li>x</li></ol>',
      (el) => el.setAttribute('type', 'a'),
      { version: 1, preset: 'balanced' },
    );
    expect(values).toContain('a');
  });
});

/**
 * `rr_open_mode` is written by the recorder itself when a <dialog> opens, and
 * carries a "generated, exempt from masking" flag for that flush. If the page
 * then writes an attribute of the same literal name, the flag no longer
 * describes the value being recorded and must be cleared, or page data would
 * ride the exemption out unmasked.
 */
describe('record() generated-attribute flag vs. a real page write', () => {
  /**
   * jsdom's selector engine has no `:modal` pseudo-class and throws on it, so
   * the one call the <dialog> branch makes is shimmed on the element itself.
   * Everything else delegates to the real implementation.
   */
  function shimModalMatches(el: Element) {
    const real = Element.prototype.matches;
    el.matches = ((selector: string) =>
      selector === 'dialog:modal'
        ? false
        : real.call(el, selector)) as Element['matches'];
  }

  function attributeMutations(events: eventWithTime[]) {
    return events.flatMap((event) =>
      event.type === EventType.IncrementalSnapshot &&
      event.data.source === IncrementalSource.Mutation
        ? event.data.attributes
        : [],
    );
  }

  it('exempts the recorder-written rr_open_mode', async () => {
    document.body.innerHTML = '<dialog>hi</dialog>';
    const dialog = document.querySelector('dialog')!;
    shimModalMatches(dialog);

    const events: eventWithTime[] = [];
    const stop = record({
      emit: (event) => events.push(event),
      maskAllElementAttributes: true,
    });
    try {
      dialog.setAttribute('open', '');
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      stop?.();
    }

    const written = attributeMutations(events).map(
      (a) => a.attributes.rr_open_mode,
    );
    expect(written).toContain('non-modal');
  });

  it('does not exempt a page write of the same attribute name in that flush', async () => {
    document.body.innerHTML = '<dialog>hi</dialog>';
    const dialog = document.querySelector('dialog')!;
    shimModalMatches(dialog);

    const events: eventWithTime[] = [];
    const stop = record({
      emit: (event) => events.push(event),
      maskAllElementAttributes: true,
    });
    try {
      dialog.setAttribute('open', '');
      dialog.setAttribute('rr_open_mode', 'page-authored');
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      stop?.();
    }

    const written = attributeMutations(events).map(
      (a) => a.attributes.rr_open_mode,
    );
    expect(written).toContain('*'.repeat('page-authored'.length));
    expect(JSON.stringify(written)).not.toContain('page-authored');
  });
});

describe('record() unmaskTextSelector reaches masked attributes', () => {
  async function titlesAfterMutation(
    html: string,
    options: Parameters<typeof record>[0],
  ) {
    document.body.innerHTML = html;
    const events: eventWithTime[] = [];
    const stop = record({ ...options, emit: (event) => events.push(event) });
    try {
      document.querySelectorAll('img').forEach((img, index) => {
        img.setAttribute('title', `updated-${index}`);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      stop?.();
    }
    return events.flatMap((event) =>
      event.type === EventType.IncrementalSnapshot &&
      event.data.source === IncrementalSource.Mutation
        ? event.data.attributes.map((a) => a.attributes.title)
        : [],
    );
  }

  it('keeps a masked attribute inside a record()-level unmask subtree', async () => {
    const titles = await titlesAfterMutation(
      '<div class="support-widget"><img title="a"></div>',
      {
        privacyPolicy: { version: 1, preset: 'balanced' },
        unmaskTextSelector: '.support-widget',
      },
    );
    expect(titles).toContain('updated-0');
  });

  it('still masks the same attribute with no unmask subtree', async () => {
    const titles = await titlesAfterMutation('<img title="a">', {
      privacyPolicy: { version: 1, preset: 'balanced' },
      unmaskTextSelector: '.support-widget',
    });
    expect(titles).toContain('*'.repeat('updated-0'.length));
    expect(titles).not.toContain('updated-0');
  });

  it('the vendor unmask class keeps working alongside it', async () => {
    const titles = await titlesAfterMutation(
      '<div class="rr-unmask"><img title="a"></div>',
      { privacyPolicy: { version: 1, preset: 'balanced' } },
    );
    expect(titles).toContain('updated-0');
  });
});

/**
 * `strict` blocks media unconditionally, so an explicit `recordCanvas: true`
 * is silently downgraded to off. That silent downgrade previously had no
 * signal at all; a caller who explicitly opted into canvas recording
 * deserves a one-time warning rather than a canvas that quietly never
 * records.
 */
describe('record() warns once when strict disables an explicit recordCanvas', () => {
  it('warns once and still leaves canvas recording off', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const stop1 = record({
        emit: () => {},
        recordCanvas: true,
        privacyPolicy: { version: 1, preset: 'strict' },
      });
      stop1?.();
      const stop2 = record({
        emit: () => {},
        recordCanvas: true,
        privacyPolicy: { version: 1, preset: 'strict' },
      });
      stop2?.();

      const strictWarnings = warn.mock.calls.filter(([msg]) =>
        String(msg).includes(
          "privacyPolicy preset 'strict' disables canvas recording",
        ),
      );
      expect(strictWarnings).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn when recordCanvas was never requested', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const stop = record({
        emit: () => {},
        privacyPolicy: { version: 1, preset: 'strict' },
      });
      stop?.();
      const strictWarnings = warn.mock.calls.filter(([msg]) =>
        String(msg).includes(
          "privacyPolicy preset 'strict' disables canvas recording",
        ),
      );
      expect(strictWarnings).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});
