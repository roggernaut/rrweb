/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
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
      applyPrivacyPolicy: () => ({ nonsense: true }) as never,
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
          (a) => 'data-x' in a.attributes && a.attributes['data-x'] === 'mutated',
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

  it('masks a live input event whose value trips a detector', async () => {
    document.body.innerHTML = '<input type="text">';
    const input = document.querySelector('input')!;

    const events: eventWithTime[] = [];
    const stop = record({
      emit: (event) => events.push(event),
      privacyPolicy: withEmailDetector,
    });
    try {
      input.value = 'bob@example.com';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      stop?.();
    }

    const inputEvents = events.filter(
      (event) =>
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Input,
    );
    expect(inputEvents.length).toBeGreaterThan(0);
    expect(JSON.stringify(inputEvents)).not.toContain('bob@example.com');
  });
});
