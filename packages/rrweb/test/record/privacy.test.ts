/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import record from '../../src/record';
import {
  EventType,
  IncrementalSource,
  type RecordPlugin,
  type eventWithTime,
} from '@rrweb/types';

describe('record() privacy policy plugin fallback', () => {
  it('a plugin returning a malformed policy falls back to the user policy instead of throwing', () => {
    const badPlugin: RecordPlugin = {
      name: 'bad@1',
      applyPrivacyPolicy: () => ({ nonsense: true } as never),
    };

    let stop: (() => void) | undefined;
    expect(() => {
      stop = record({ emit: () => {}, plugins: [badPlugin] });
    }).not.toThrow();
    stop?.();
  });

  it('still throws when the user supplies their own invalid policy directly (no plugin involved)', () => {
    expect(() => {
      record({
        emit: () => {},
        // @ts-expect-error intentionally invalid for this test
        privacyPolicy: { nonsense: true },
      });
    }).toThrow();
  });
});

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

describe('record() privacy detectors on live updates', () => {
  const withEmailDetector = {
    version: 1,
    preset: 'legacy',
    detectors: { email: true },
  } as const;

  it('masks a characterData mutation whose new text trips a detector', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const textNode = document.querySelector('p')!.firstChild as Text;

    const events: eventWithTime[] = [];
    const stop = record({
      emit: (event) => events.push(event),
      privacyPolicy: withEmailDetector,
    });
    try {
      textNode.data = 'contact bob@example.com';
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      stop?.();
    }

    const textMutations = events.flatMap((event) =>
      event.type === EventType.IncrementalSnapshot &&
      event.data.source === IncrementalSource.Mutation
        ? event.data.texts
        : [],
    );
    expect(textMutations.length).toBeGreaterThan(0);
    expect(JSON.stringify(textMutations)).not.toContain('bob@example.com');
  });

  it('leaves a characterData mutation with clean text untouched under legacy', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const textNode = document.querySelector('p')!.firstChild as Text;

    const events: eventWithTime[] = [];
    const stop = record({
      emit: (event) => events.push(event),
      privacyPolicy: withEmailDetector,
    });
    try {
      textNode.data = 'still plain text';
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      stop?.();
    }

    const textMutations = events.flatMap((event) =>
      event.type === EventType.IncrementalSnapshot &&
      event.data.source === IncrementalSource.Mutation
        ? event.data.texts
        : [],
    );
    expect(JSON.stringify(textMutations)).toContain('still plain text');
  });

  it('never scans <style> text mutations, even with detectors on', async () => {
    document.body.innerHTML = '<style>body{color:red}</style>';
    const textNode = document.querySelector('style')!.firstChild as Text;

    const events: eventWithTime[] = [];
    const stop = record({
      emit: (event) => events.push(event),
      privacyPolicy: withEmailDetector,
    });
    try {
      // an email-shaped token inside CSS content must never star the sheet
      textNode.data = '/* bob@example.com */ body{color:blue}';
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      stop?.();
    }

    const textMutations = events.flatMap((event) =>
      event.type === EventType.IncrementalSnapshot &&
      event.data.source === IncrementalSource.Mutation
        ? event.data.texts
        : [],
    );
    expect(JSON.stringify(textMutations)).toContain('body{color:blue}');
  });

  /** The masked values the recorder emitted, in order. */
  async function recordInputValues(
    markup: string,
    drive: (input: HTMLInputElement) => void,
    options: { unmaskTextSelector?: string } = {},
  ): Promise<string[]> {
    document.body.innerHTML = markup;
    const input = document.querySelector('input')!;
    const events: eventWithTime[] = [];
    const stop = record({
      emit: (event) => events.push(event),
      privacyPolicy: withEmailDetector,
      ...options,
    });
    try {
      drive(input);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      stop?.();
    }
    return events.flatMap((event) =>
      event.type === EventType.IncrementalSnapshot &&
      event.data.source === IncrementalSource.Input
        ? [event.data.text]
        : [],
    );
  }

  it('occludes a typed value at every keystroke length', async () => {
    // The leak this replaced: scanning per input event recorded every prefix
    // shorter than the first Luhn-valid length verbatim, so the full card
    // number was reconstructable even though the final value came out masked.
    const card = '4111111111111111';
    const values = await recordInputValues('<input type="text">', (input) => {
      for (let i = 1; i <= card.length; i++) {
        input.value = card.slice(0, i);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    expect(values.length).toBe(card.length);
    values.forEach((value, i) => expect(value).toBe('*'.repeat(i + 1)));
  });

  it('occludes a pasted value, matched or not', async () => {
    const values = await recordInputValues('<input type="text">', (input) => {
      input.value = 'bob@example.com';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.value = 'nothing sensitive here';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(values).toEqual([
      '*'.repeat('bob@example.com'.length),
      '*'.repeat('nothing sensitive here'.length),
    ]);
  });

  it('no unmask escape reveals an input value while detectors are on', async () => {
    const values = await recordInputValues(
      '<input class="rr-unmask" type="text">',
      (input) => {
        input.value = 'Visible Name';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
      { unmaskTextSelector: '.rr-unmask' },
    );
    expect(values).toEqual(['*'.repeat('Visible Name'.length)]);
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

describe('record() per-flush mask-decision memoisation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const textMutationsIn = (events: eventWithTime[]) =>
    events.flatMap((event) =>
      event.type === EventType.IncrementalSnapshot &&
      event.data.source === IncrementalSource.Mutation
        ? event.data.texts
        : [],
    );

  /**
   * Counts only the ancestor-walk probes: `needMaskingText` is the sole caller
   * that passes the compiled unmask selector to `Element.prototype.matches`
   * (`finalizeAttribute`'s unmask check goes through `closest`). One walk over
   * this document touches the mutated node's parent, `<body>` and `<html>`, so
   * an uncached flush of N text mutations under one parent would be N times
   * whatever a single one costs.
   */
  function countUnmaskWalkProbes() {
    const original = Element.prototype.matches;
    let calls = 0;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      if (selector.includes('data-privacy="allow"')) calls += 1;
      return original.call(this, selector);
    });
    return () => calls;
  }

  it('walks the ancestor chain once for many text mutations sharing a parent', async () => {
    // The `.rr-unmask` target keeps `resolveUnmaskTextSelector` from nulling
    // the selector for the flush -- with no match anywhere the walk would
    // short-circuit and there would be nothing to memoise.
    document.body.innerHTML =
      '<div class="rr-unmask">keep</div><div id="host"></div>';
    const host = document.getElementById('host')!;
    const nodes: Text[] = [];
    for (let index = 0; index < 10; index += 1) {
      const text = document.createTextNode(`t${index}`);
      host.appendChild(text);
      nodes.push(text);
    }

    const events: eventWithTime[] = [];
    const stop = record({
      emit: (event) => events.push(event),
      privacyPolicy: { version: 1, preset: 'balanced' },
    });
    // Spy only after the initial full snapshot, which legitimately walks every
    // node; this test is about the mutation flush.
    const probes = countUnmaskWalkProbes();
    try {
      nodes.forEach((node, index) => {
        node.data = `updated-${index}`;
      });
      await flush();
    } finally {
      stop?.();
    }

    // All ten mutations were seen...
    expect(textMutationsIn(events)).toHaveLength(10);
    // ...but the shared parent's chain was walked for the first one only.
    // Three levels (#host, body, html), not thirty.
    expect(probes()).toBeGreaterThan(0);
    expect(probes()).toBeLessThan(10);
  });

  it('does not carry a decision across flushes: a later .rr-mask still masks', async () => {
    document.body.innerHTML =
      '<div class="rr-unmask">keep</div><div id="host">before</div>';
    const host = document.getElementById('host')!;
    const textNode = host.firstChild as Text;

    const events: eventWithTime[] = [];
    const stop = record({
      emit: (event) => events.push(event),
      privacyPolicy: { version: 1, preset: 'balanced' },
    });
    try {
      textNode.data = 'first-plain';
      await flush();
      host.classList.add('rr-mask');
      await flush();
      textNode.data = 'second-secret';
      await flush();
    } finally {
      stop?.();
    }

    const values = textMutationsIn(events).map((text) => text.value);
    expect(values).toContain('first-plain');
    expect(values).not.toContain('second-secret');
    expect(values).toContain('*'.repeat('second-secret'.length));
  });
});
