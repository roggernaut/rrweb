/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
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

/**
 * The mutation path's `finalizeAttribute` reads the compiled policy's own
 * `unmaskTextSelector`, so `record()` writes the merged record()-level option
 * back onto the policy. Without that, the option would only affect text.
 */
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
