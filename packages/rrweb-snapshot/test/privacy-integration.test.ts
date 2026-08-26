/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import snapshot from '../src/snapshot';
import { compilePrivacyPolicy, finalizeAttribute } from '../src/privacy';
import { maskInput, isProtectedInput } from '../src/utils';
import type { PrivacyPolicy } from '../src/types';

function serialize(html: string, privacyPolicy?: PrivacyPolicy): string {
  document.body.innerHTML = html;
  return JSON.stringify(snapshot(document, { privacyPolicy }));
}

/** Attaches an open shadow root to `#host` and fills it. */
function withShadowRoot(lightHtml: string, shadowHtml: string): void {
  document.body.innerHTML = lightHtml;
  const host = document.querySelector('#host') as HTMLElement;
  host.attachShadow({ mode: 'open' }).innerHTML = shadowHtml;
}

describe('text masking v2', () => {
  const strict: PrivacyPolicy = { version: 1, preset: 'strict' };

  it('strict masks page text', () => {
    expect(serialize('<p>hello world</p>', strict)).not.toContain(
      'hello world',
    );
  });

  it('never masks <style> text, even under strict inside masked subtrees', () => {
    const out = serialize(
      '<div><style>body{color:red}</style><p>secret</p></div>',
      strict,
    );
    expect(out).toMatch(/body\s*\{\s*color:\s*red/);
    expect(out).not.toContain('secret');
  });

  it('never masks the <style> text node itself when the css is not captured as _cssText', () => {
    document.body.innerHTML =
      '<div><style>body{color:red}</style><p>secret</p></div>';
    const styleEl = document.querySelector('style') as HTMLStyleElement;
    // with no CSSOM sheet (CSP, cross-origin) the CSS stays on the text node
    // instead of moving to `_cssText`, which is what actually exercises
    // serializeTextNode's `isStyle` exemption
    Object.defineProperty(styleEl, 'sheet', { get: () => null });
    const out = JSON.stringify(snapshot(document, { privacyPolicy: strict }));
    expect(out).toContain('body{color:red}');
    expect(out).not.toContain('secret');
  });

  it('unmask selector wins for its subtree, nearest ancestor decides', () => {
    const out = serialize(
      '<div class="rr-unmask"><p>visible</p><div class="rr-mask"><p>hidden</p></div></div>',
      strict,
    );
    expect(out).toContain('visible');
    expect(out).not.toContain('hidden');
  });

  it('detectors mask the whole text node under legacy when configured', () => {
    const withDetectors: PrivacyPolicy = {
      version: 1,
      preset: 'legacy',
      detectors: { paymentCard: true, phone: true },
    };
    const out = serialize(
      '<p>call 5551234567 4111 1111 1111 1111 now</p>',
      withDetectors,
    );
    expect(out).not.toContain('4111 1111 1111 1111');
  });

  it('keeps masking inherited from an ancestor outside the shadow root', () => {
    withShadowRoot(
      '<div class="rr-mask"><div id="host"></div></div>',
      '<p>secret</p>',
    );
    const out = JSON.stringify(
      snapshot(document, {
        privacyPolicy: { version: 1, preset: 'balanced' },
      }),
    );
    expect(out).not.toContain('secret');
  });

  it('lets an unmask selector inside the shadow root escape a masked host', () => {
    withShadowRoot(
      '<div class="rr-mask"><div id="host"></div></div>',
      '<div class="rr-unmask"><p>visible</p></div>',
    );
    const out = JSON.stringify(
      snapshot(document, {
        privacyPolicy: { version: 1, preset: 'balanced' },
      }),
    );
    expect(out).toContain('visible');
  });

  it('masks a text node parented directly by a shadow root under strict', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.querySelector('#host') as HTMLElement;
    host
      .attachShadow({ mode: 'open' })
      .appendChild(document.createTextNode('secret'));
    const out = JSON.stringify(snapshot(document, { privacyPolicy: strict }));
    expect(out).not.toContain('secret');
  });

  it('legacy without detectors leaves text untouched', () => {
    expect(serialize('<p>bob@example.com</p>', undefined)).toContain(
      'bob@example.com',
    );
  });
});

describe('maskInput v2', () => {
  const balanced = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
  const legacy = compilePrivacyPolicy(undefined);
  const input = (attrs = '') => {
    document.body.innerHTML = `<input ${attrs} value="4111 1111 1111 1111">`;
    return document.querySelector('input') as HTMLInputElement;
  };
  it('balanced masks all inputs shape-free (stars, not digits)', () => {
    const out = maskInput({
      element: input(),
      tagName: 'input',
      type: 'text',
      value: '4111 1111 1111 1111',
      maskInputOptions: {},
      privacy: balanced,
    });
    expect(out).toBe('*'.repeat(19));
  });
  it('balanced + maskInputFn: fn controls length only, never content', () => {
    const out = maskInput({
      element: input(),
      tagName: 'input',
      type: 'text',
      value: 'secret',
      maskInputOptions: {},
      maskInputFn: () => '[redacted]',
      privacy: balanced,
    });
    expect(out).toBe('*'.repeat('[redacted]'.length));
  });
  it('legacy + maskInputFn trusted verbatim when legacy options mask', () => {
    const out = maskInput({
      element: input(),
      tagName: 'input',
      type: 'text',
      value: 'secret',
      maskInputOptions: { text: true },
      maskInputFn: () => '[redacted]',
      privacy: legacy,
    });
    expect(out).toBe('[redacted]');
  });
  it('legacy without options passes value through', () => {
    expect(
      maskInput({
        element: input(),
        tagName: 'input',
        type: 'text',
        value: 'plain',
        maskInputOptions: {},
        privacy: legacy,
      }),
    ).toBe('plain');
  });
  it('protected inputs always mask, even legacy with no options', () => {
    expect(
      maskInput({
        element: input('type="password"'),
        tagName: 'input',
        type: 'password',
        value: 'pw',
        maskInputOptions: {},
        privacy: legacy,
      }),
    ).toBe('**');
    expect(isProtectedInput(input('autocomplete="cc-number"'))).toBe(true);
  });
});

describe('finalizeAttribute', () => {
  const strict = compilePrivacyPolicy({ version: 1, preset: 'strict' });
  const balanced = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
  const legacy = compilePrivacyPolicy({ version: 1, preset: 'legacy' });

  const el = (
    html = '<img title="Bob" style="color:red" src="https://u:p@a.com/i.png?token=t">',
    selector = 'img',
  ) => {
    document.body.innerHTML = html;
    return document.querySelector(selector) as Element;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never masks style, even under strict', () => {
    expect(
      finalizeAttribute({
        element: el(),
        name: 'style',
        value: 'color:red',
        privacy: strict,
      }),
    ).toBe('color:red');
  });

  it('never masks _cssText, on any path', () => {
    expect(
      finalizeAttribute({
        element: el('<style></style>', 'style'),
        name: '_cssText',
        value: 'body{color:red}',
        privacy: strict,
        maskAllElementAttributes: true,
      }),
    ).toBe('body{color:red}');
  });

  it('masks listed attributes under strict/balanced', () => {
    expect(
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: 'Bob',
        privacy: strict,
      }),
    ).toBe('***');
    expect(
      finalizeAttribute({
        element: el(),
        name: 'placeholder',
        value: 'Bob',
        privacy: balanced,
      }),
    ).toBe('***');
    expect(
      finalizeAttribute({
        element: el(),
        name: 'aria-label',
        value: 'Bob',
        privacy: legacy,
      }),
    ).toBe('Bob');
  });

  it('strict nulls media sources; URLs sanitized elsewhere', () => {
    expect(
      finalizeAttribute({
        element: el(),
        name: 'src',
        value: 'https://a.com/i.png',
        privacy: strict,
      }),
    ).toBeNull();
    expect(
      finalizeAttribute({
        element: el('<a href="#"></a>', 'a'),
        name: 'href',
        value: 'https://u:p@a.com/x?token=t',
        privacy: balanced,
      }),
    ).toBe('https://a.com/x?token=*');
    // non-media element keeps a sanitized src under strict
    expect(
      finalizeAttribute({
        element: el('<div></div>', 'div'),
        name: 'src',
        value: 'https://a.com/x?page=1',
        privacy: strict,
      }),
    ).toBe('https://a.com/x?page=*');
  });

  it('masks value on form tags under strict only', () => {
    expect(
      finalizeAttribute({
        element: el('<input value="abc">', 'input'),
        name: 'value',
        value: 'abc',
        privacy: strict,
      }),
    ).toBe('***');
    expect(
      finalizeAttribute({
        element: el('<li value="3"></li>', 'li'),
        name: 'value',
        value: '3',
        privacy: strict,
      }),
    ).toBe('3');
    expect(
      finalizeAttribute({
        element: el('<input value="abc">', 'input'),
        name: 'value',
        value: 'abc',
        privacy: balanced,
      }),
    ).toBe('abc');
  });

  it('maskAllElementAttributes stars everything except generated', () => {
    expect(
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: 'Bob',
        privacy: undefined,
        maskAllElementAttributes: true,
      }),
    ).toBe('***');
    expect(
      finalizeAttribute({
        element: el(),
        name: 'rr_open_mode',
        value: 'modal',
        privacy: undefined,
        maskAllElementAttributes: true,
        isGenerated: true,
      }),
    ).toBe('modal');
  });

  it('generated attributes are exempt from maskAttributeFn and the policy', () => {
    expect(
      finalizeAttribute({
        element: el(),
        name: 'rr_width',
        value: '100px',
        privacy: strict,
        maskAttributeFn: () => 'nope',
        isGenerated: true,
      }),
    ).toBe('100px');
  });

  // NOTE: must be the first test in this file that combines maskAll + fn --
  // the warning is one-time per module instance.
  it('warns once when maskAttributeFn is ignored under maskAllElementAttributes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const call = () =>
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: 'Bob',
        privacy: undefined,
        maskAllElementAttributes: true,
        maskAttributeFn: () => 'from-fn',
      });
    expect(call()).toBe('***');
    expect(call()).toBe('***');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('maskAttributeFn throw fails closed to stars; fn ignored under maskAll', () => {
    expect(
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: 'Bob',
        privacy: undefined,
        maskAttributeFn: () => {
          throw new Error('boom');
        },
      }),
    ).toBe('***');
    expect(
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: 'Bob',
        privacy: strict,
        maskAllElementAttributes: true,
        maskAttributeFn: () => 'from-fn',
      }),
    ).toBe('***');
  });

  it('feeds maskAttributeFn output into the policy, which is the final authority', () => {
    // The callback is a pipeline stage, not an escape hatch: under balanced or
    // strict the policy applies on top of whatever it returned.
    expect(
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: 'Bob',
        privacy: strict,
        maskAttributeFn: (name, value) => `[${name}:${value.length}]`,
      }),
    ).toBe('*'.repeat('[title:3]'.length));
    expect(
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: 'Bob',
        privacy: balanced,
        maskAttributeFn: () => '[MASKED]',
      }),
    ).toBe('*'.repeat('[MASKED]'.length));
    // Under legacy the policy block is the identity, so the callback's output
    // survives verbatim.
    expect(
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: 'Bob',
        privacy: legacy,
        maskAttributeFn: () => '[MASKED]',
      }),
    ).toBe('[MASKED]');
    // ...and an attribute the policy does not touch keeps the fn's output on
    // every preset.
    expect(
      finalizeAttribute({
        element: el(),
        name: 'data-x',
        value: 'Bob',
        privacy: strict,
        maskAttributeFn: () => '[MASKED]',
      }),
    ).toBe('[MASKED]');
  });

  it('drops a media source the fn emptied, rather than recording src=""', () => {
    // '' must not short-circuit the policy: rebuild.ts treats null (attribute
    // removed) and '' (setAttribute(name, '')) differently, so an emptied
    // <img src> under strict has to come out null, not ''.
    expect(
      finalizeAttribute({
        element: el(),
        name: 'src',
        value: 'https://a.com/i.png',
        privacy: strict,
        maskAttributeFn: () => '',
      }),
    ).toBeNull();
    expect(
      finalizeAttribute({
        element: el('<iframe src="https://x.com/"></iframe>', 'iframe'),
        name: 'rr_src',
        value: 'https://x.com/',
        privacy: strict,
        maskAttributeFn: () => '',
      }),
    ).toBeNull();
    // On the branches that do not drop it, an emptied value stays empty
    // instead of being resolved into a path by sanitizeUrl.
    expect(
      finalizeAttribute({
        element: el('<a href="#"></a>', 'a'),
        name: 'href',
        value: 'https://x.com/',
        privacy: balanced,
        maskAttributeFn: () => '',
      }),
    ).toBe('');
    expect(
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: 'Bob',
        privacy: strict,
        maskAttributeFn: () => '',
      }),
    ).toBe('');
  });

  it('fails closed when maskAttributeFn returns a non-string', () => {
    expect(
      finalizeAttribute({
        element: el(),
        name: 'data-x',
        value: 'Bob',
        privacy: legacy,
        maskAttributeFn: () => undefined as unknown as string,
      }),
    ).toBe('***');
    expect(
      finalizeAttribute({
        element: el(),
        name: 'data-x',
        value: 'a longer value',
        privacy: undefined,
        maskAttributeFn: () => ({ nope: true }) as unknown as string,
      }),
    ).toBe('*'.repeat('a longer value'.length));
  });

  it('applies the strict media-source and URL rules to the renamed rr_src', () => {
    const iframe = () => el('<iframe src="https://x.com/"></iframe>', 'iframe');
    expect(
      finalizeAttribute({
        element: iframe(),
        name: 'rr_src',
        value: 'https://u:p@x.com/?token=t',
        privacy: strict,
      }),
    ).toBeNull();
    expect(
      finalizeAttribute({
        element: iframe(),
        name: 'rr_src',
        value: 'https://u:p@x.com/?token=t',
        privacy: balanced,
      }),
    ).toBe('https://x.com/?token=*');
  });

  it('passes through null/empty values and untouched attributes', () => {
    expect(
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: null,
        privacy: strict,
      }),
    ).toBeNull();
    expect(
      finalizeAttribute({
        element: el(),
        name: 'data-x',
        value: 'plain',
        privacy: strict,
      }),
    ).toBe('plain');
  });
});

describe('attribute finalization through the serializer', () => {
  /**
   * A cross-origin `<iframe>` rrweb cannot see into has its `src` renamed to
   * `rr_src` *before* finalization runs, so the renamed name has to carry the
   * same policy weight as `src` -- otherwise userinfo and query tokens ride
   * out of the recording verbatim.
   */
  function serializeOpaqueIframe(
    src: string,
    privacyPolicy: PrivacyPolicy,
  ): string {
    document.body.innerHTML = `<iframe src="${src}"></iframe>`;
    // jsdom hands out a blank contentDocument for every iframe; a real
    // cross-origin frame has none, which is what triggers the rr_src rename.
    Object.defineProperty(document.querySelector('iframe')!, 'contentDocument', {
      value: null,
    });
    return JSON.stringify(snapshot(document, { privacyPolicy }));
  }

  it('sanitizes the renamed rr_src of a cross-origin iframe under balanced', () => {
    const out = serializeOpaqueIframe('https://u:p@x.com/?token=t', {
      version: 1,
      preset: 'balanced',
    });
    expect(out).toContain('"rr_src":"https://x.com/?token=*"');
    expect(out).not.toContain('u:p@x.com');
    expect(out).not.toContain('token=t');
  });

  it('drops the renamed rr_src of a cross-origin iframe under strict', () => {
    const out = serializeOpaqueIframe('https://u:p@x.com/?token=t', {
      version: 1,
      preset: 'strict',
    });
    expect(out).toContain('"rr_src":null');
    expect(out).not.toContain('x.com');
  });
});
