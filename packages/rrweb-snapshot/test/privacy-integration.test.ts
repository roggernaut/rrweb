/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import snapshot from '../src/snapshot';
import {
  compilePrivacyPolicy,
  finalizeAttribute,
  resolvePrivacyContext,
  resolveTextValue,
} from '../src/privacy';
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

  it('does not let a foreign unmask token escape strict masking', () => {
    const out = serialize(
      '<div class="amp-unmask"><p>still hidden</p></div>',
      strict,
    );
    expect(out).not.toContain('still hidden');
  });

  /**
   * `vendorCompat` can only ever add masking or blocking, never reveal:
   * `.amp-unmask` stays unhonored even with the flag on. See the guide's
   * vendor-recognition section.
   */
  it('still does not honor .amp-unmask once vendorCompat is on', () => {
    const out = serialize('<div class="amp-unmask"><p>still hidden</p></div>', {
      version: 1,
      preset: 'strict',
      vendorCompat: true,
    });
    expect(out).not.toContain('still hidden');
  });

  it('recognizes a foreign mask class only once vendorCompat is on', () => {
    const balanced: PrivacyPolicy = { version: 1, preset: 'balanced' };
    expect(
      serialize('<div class="ph-mask"><p>phtext</p></div>', balanced),
    ).toContain('phtext');
    expect(
      serialize('<div class="ph-mask"><p>phtext</p></div>', {
        ...balanced,
        vendorCompat: true,
      }),
    ).not.toContain('phtext');
  });

  it('recognizes a foreign block class only once vendorCompat is on', () => {
    const balanced: PrivacyPolicy = { version: 1, preset: 'balanced' };
    expect(
      serialize('<div class="ph-no-capture"><p>phblock</p></div>', balanced),
    ).toContain('phblock');
    expect(
      serialize('<div class="ph-no-capture"><p>phblock</p></div>', {
        ...balanced,
        vendorCompat: true,
      }),
    ).not.toContain('phblock');
  });

  /**
   * The fail-closed rule, end to end: a `data-privacy` typo protects the
   * subtree instead of silently doing nothing.
   */
  it('masks a subtree whose data-privacy value is not recognized', () => {
    const balanced: PrivacyPolicy = { version: 1, preset: 'balanced' };
    expect(
      serialize('<div data-privacy="masked"><p>typo text</p></div>', balanced),
    ).not.toContain('typo text');
    expect(
      serialize('<div data-privacy=""><p>empty value</p></div>', balanced),
    ).not.toContain('empty value');
    // the recognized values are unaffected
    expect(
      serialize('<div data-privacy="unmask"><p>kept</p></div>', strict),
    ).toContain('kept');
    expect(
      serialize('<div data-privacy="mask"><p>gone</p></div>', balanced),
    ).not.toContain('gone');
    expect(
      serialize('<div data-privacy="block"><p>blocked</p></div>', balanced),
    ).not.toContain('blocked');
  });

  /**
   * Different levels: nearest ancestor wins (covered above). Same element:
   * mask wins. Sentry resolves the tie with `maskDistance <= unmaskDistance`,
   * and Amplitude and Mixpanel both check their mask list first -- an element
   * carrying both markers is masked everywhere, so rrweb matches.
   */
  it('same element matching both mask and unmask is masked, not unmasked', () => {
    const out = serialize(
      '<div class="rr-unmask rr-mask"><p>tie broken</p></div>',
      strict,
    );
    expect(out).not.toContain('tie broken');
  });

  it('same-element tie is masked for the data-privacy variant too', () => {
    const out = serialize(
      '<div data-privacy="unmask" class="rr-mask"><p>tie broken</p></div>',
      strict,
    );
    expect(out).not.toContain('tie broken');
  });

  it('same-element tie is masked under balanced, where nothing else masks', () => {
    const out = serialize(
      '<div class="rr-unmask rr-mask"><p>tie broken</p></div><p>untouched</p>',
      { version: 1, preset: 'balanced' },
    );
    expect(out).not.toContain('tie broken');
    // balanced does not mask page text at large -- only the tied element
    expect(out).toContain('untouched');
  });

  it('a mask tie on an ancestor still loses to a nearer unmask descendant', () => {
    // the same-element rule must not leak into the cross-level rule
    const out = serialize(
      '<div class="rr-unmask rr-mask"><div class="rr-unmask"><p>visible</p></div><p>hidden</p></div>',
      strict,
    );
    expect(out).toContain('visible');
    expect(out).not.toContain('hidden');
  });

  it("a user-supplied unmaskTextSelector escapes strict's mask-everything default", () => {
    document.body.innerHTML =
      '<div class="support-widget"><p>visible</p></div><p>hidden</p>';
    const out = JSON.stringify(
      snapshot(document, {
        privacyPolicy: strict,
        unmaskTextSelector: '.support-widget',
      }),
    );
    expect(out).toContain('visible');
    expect(out).not.toContain('hidden');
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

  it('minimal leaves text untouched', () => {
    expect(serialize('<p>bob@example.com</p>', undefined)).toContain(
      'bob@example.com',
    );
  });
});

describe('data-privacy="ignore" snapshots exactly like mask', () => {
  const balanced: PrivacyPolicy = { version: 1, preset: 'balanced' };

  it('masks text and attributes identically to data-privacy="mask"', () => {
    const markup = (verb: string) =>
      `<div data-privacy="${verb}" title="secret title"><p>secret text</p></div>`;
    const asIgnore = serialize(markup('ignore'), balanced);
    expect(asIgnore).not.toContain('secret text');
    expect(asIgnore).not.toContain('secret title');
    // Identical to the mask serialization, apart from the verb itself and
    // the serializer's global node-id counter.
    const normalize = (out: string) =>
      out.replace(/"(rootId|id)":\d+/g, '"$1":0');
    expect(
      normalize(
        asIgnore.replace('"data-privacy":"ignore"', '"data-privacy":"mask"'),
      ),
    ).toBe(normalize(serialize(markup('mask'), balanced)));
  });

  it('a descendant unmask re-enables content inside an ignore subtree', () => {
    const out = serialize(
      '<div data-privacy="ignore"><p>hidden text</p><div data-privacy="unmask"><p>shown text</p></div></div>',
      balanced,
    );
    expect(out).not.toContain('hidden text');
    expect(out).toContain('shown text');
  });

  it('same-element ignore + .rr-unmask resolves to ignore: still masked', () => {
    const out = serialize(
      '<div class="rr-unmask" data-privacy="ignore"><p>secret text</p></div>',
      balanced,
    );
    expect(out).not.toContain('secret text');
  });

  it('legacy .rr-ignore never masks content', () => {
    const out = serialize(
      '<div class="rr-ignore"><p>legacy text</p></div>',
      balanced,
    );
    expect(out).toContain('legacy text');
  });
});

describe('maskInput v2', () => {
  const balanced = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
  const minimal = compilePrivacyPolicy(undefined);
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
  // The callback decides length, never content, and a broken callback must
  // not take the snapshot down or record the raw value: same contract as
  // `maskAttributeFn` in `finalizeAttribute`.
  it('balanced + maskInputFn returning a non-string fails closed to stars', () => {
    const out = maskInput({
      element: input(),
      tagName: 'input',
      type: 'text',
      value: 'secret',
      maskInputOptions: {},
      maskInputFn: (() => undefined) as unknown as (v: string) => string,
      privacy: balanced,
    });
    expect(out).toBe('*'.repeat('secret'.length));
  });
  it('maskInputFn that throws fails closed to stars, on any preset', () => {
    const boom = () => {
      throw new Error('boom');
    };
    for (const privacy of [balanced, minimal]) {
      const out = maskInput({
        element: input(),
        tagName: 'input',
        type: 'text',
        value: 'secret',
        maskInputOptions: { text: true },
        maskInputFn: boom,
        privacy,
      });
      expect(out).toBe('*'.repeat('secret'.length));
    }
  });
  it('minimal + maskInputFn returning a non-string fails closed to stars', () => {
    const out = maskInput({
      element: input(),
      tagName: 'input',
      type: 'text',
      value: 'secret',
      maskInputOptions: { text: true },
      maskInputFn: (() => 42) as unknown as (v: string) => string,
      privacy: minimal,
    });
    expect(out).toBe('*'.repeat('secret'.length));
  });
  it('maskTextFn that throws or returns a non-string fails closed to stars', () => {
    const parent = document.createElement('p');
    const base = {
      value: 'hello world',
      parent,
      needsMask: true,
      exemptScript: false,
    };
    expect(
      resolveTextValue({
        ...base,
        maskTextFn: () => {
          throw new Error('boom');
        },
      }),
    ).toBe('***** *****');
    expect(
      resolveTextValue({
        ...base,
        maskTextFn: (() => null) as unknown as (v: string) => string,
      }),
    ).toBe('***** *****');
  });
  it('minimal + maskInputFn trusted verbatim when minimal options mask', () => {
    const out = maskInput({
      element: input(),
      tagName: 'input',
      type: 'text',
      value: 'secret',
      maskInputOptions: { text: true },
      maskInputFn: () => '[redacted]',
      privacy: minimal,
    });
    expect(out).toBe('[redacted]');
  });
  it('minimal without options passes value through', () => {
    expect(
      maskInput({
        element: input(),
        tagName: 'input',
        type: 'text',
        value: 'plain',
        maskInputOptions: {},
        privacy: minimal,
      }),
    ).toBe('plain');
  });
  it('protected inputs always mask, even minimal with no options', () => {
    expect(
      maskInput({
        element: input('type="password"'),
        tagName: 'input',
        type: 'password',
        value: 'pw',
        maskInputOptions: {},
        privacy: minimal,
      }),
    ).toBe('**');
    expect(isProtectedInput(input('autocomplete="cc-number"'))).toBe(true);
  });
});

describe('finalizeAttribute', () => {
  const strict = compilePrivacyPolicy({ version: 1, preset: 'strict' });
  const balanced = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
  const minimal = compilePrivacyPolicy({ version: 1, preset: 'minimal' });

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
        privacy: minimal,
      }),
    ).toBe('Bob');
  });

  it('strict nulls media sources, and only on media tags', () => {
    expect(
      finalizeAttribute({
        element: el(),
        name: 'src',
        value: 'https://a.com/i.png',
        privacy: strict,
      }),
    ).toBeNull();
    // non-media element keeps its src under strict
    expect(
      finalizeAttribute({
        element: el('<div></div>', 'div'),
        name: 'src',
        value: 'https://a.com/x?page=1',
        privacy: strict,
      }),
    ).toBe('https://a.com/x?page=1');
  });

  describe('dimension-preserving placeholders for blocked images', () => {
    it('swaps a blocked img src for a same-size SVG when dimensions are declared', () => {
      const out = finalizeAttribute({
        element: el('<img src="https://a.com/i.png" width="120" height="80">'),
        name: 'src',
        value: 'https://a.com/i.png',
        privacy: strict,
      });
      expect(out).toMatch(/^data:image\/svg\+xml;utf8,/);
      expect(out).toContain('width="120"');
      expect(out).toContain('height="80"');
      // the real source never survives into the placeholder
      expect(out).not.toContain('a.com');
    });

    it('covers srcset on an img and poster on a video', () => {
      expect(
        finalizeAttribute({
          element: el('<img srcset="a.png 1x" width="10" height="10">'),
          name: 'srcset',
          value: 'a.png 1x',
          privacy: strict,
        }),
      ).toContain('width="10"');
      expect(
        finalizeAttribute({
          element: el(
            '<video poster="p.png" width="640" height="360"></video>',
            'video',
          ),
          name: 'poster',
          value: 'p.png',
          privacy: strict,
        }),
      ).toContain('width="640"');
    });

    it('keeps returning null for an img with no declared dimensions', () => {
      expect(
        finalizeAttribute({
          element: el('<img src="https://a.com/i.png">'),
          name: 'src',
          value: 'https://a.com/i.png',
          privacy: strict,
        }),
      ).toBeNull();
    });

    it.each([
      ['<img src="i.png" width="50%" height="80">'],
      ['<img src="i.png" width="auto" height="auto">'],
      ['<img src="i.png" width="-10" height="10">'],
      ['<img src="i.png" width="120">'],
    ])('rejects unusable dimensions: %s', (html) => {
      expect(
        finalizeAttribute({
          element: el(html),
          name: 'src',
          value: 'i.png',
          privacy: strict,
        }),
      ).toBeNull();
    });

    it('derives placeholder dimensions from content attributes only, never a layout measurement', () => {
      const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
      finalizeAttribute({
        element: el('<img src="https://a.com/i.png" width="120" height="80">'),
        name: 'src',
        value: 'https://a.com/i.png',
        privacy: strict,
      });
      expect(rect).not.toHaveBeenCalled();
      rect.mockRestore();
    });

    it('leaves non-image media sources dropped even when sized', () => {
      // the renamed cross-origin iframe source
      expect(
        finalizeAttribute({
          element: el('<iframe width="300" height="200"></iframe>', 'iframe'),
          name: 'rr_src',
          value: 'https://x.com/',
          privacy: strict,
        }),
      ).toBeNull();
      expect(
        finalizeAttribute({
          element: el('<embed src="a.swf" width="10" height="10">', 'embed'),
          name: 'src',
          value: 'a.swf',
          privacy: strict,
        }),
      ).toBeNull();
      expect(
        finalizeAttribute({
          element: el('<audio src="a.mp3"></audio>', 'audio'),
          name: 'src',
          value: 'a.mp3',
          privacy: strict,
        }),
      ).toBeNull();
      expect(
        finalizeAttribute({
          element: el('<source src="a.png" width="10" height="10">', 'source'),
          name: 'src',
          value: 'a.png',
          privacy: strict,
        }),
      ).toBeNull();
    });
  });

  describe('operational attributes are exempt from every masking branch', () => {
    it('maskAllElementAttributes cannot star data-privacy', () => {
      expect(
        finalizeAttribute({
          element: el('<div data-privacy="mask"></div>', 'div'),
          name: 'data-privacy',
          value: 'mask',
          privacy: strict,
          maskAllElementAttributes: true,
        }),
      ).toBe('mask');
    });

    it('maskAllElementAttributes cannot star data-rr-is-password', () => {
      expect(
        finalizeAttribute({
          element: el('<input data-rr-is-password="true">', 'input'),
          name: 'data-rr-is-password',
          value: 'true',
          privacy: strict,
          maskAllElementAttributes: true,
        }),
      ).toBe('true');
    });

    it('the exemption covers only names a code path reads back', () => {
      // `data-rrweb-id` used to sit in the set although nothing in the repo
      // reads it. An exemption is unconditional, so a name that buys nothing
      // is pure downside: it stays maskable.
      expect(
        finalizeAttribute({
          element: el('<div data-rrweb-id="42"></div>', 'div'),
          name: 'data-rrweb-id',
          value: '42',
          privacy: strict,
          maskAllElementAttributes: true,
        }),
      ).toBe('**');
    });

    it('maskAttributeFn is never invoked for an operational attribute', () => {
      const maskAttributeFn = vi.fn(() => 'REWRITTEN');
      expect(
        finalizeAttribute({
          element: el('<div data-privacy="unmask"></div>', 'div'),
          name: 'data-privacy',
          value: 'unmask',
          privacy: strict,
          maskAttributeFn,
        }),
      ).toBe('unmask');
      expect(maskAttributeFn).not.toHaveBeenCalled();
      // ...but it still runs for an ordinary attribute on the same element
      finalizeAttribute({
        element: el('<div data-privacy="unmask" title="x"></div>', 'div'),
        name: 'title',
        value: 'x',
        privacy: minimal,
        maskAttributeFn,
      });
      expect(maskAttributeFn).toHaveBeenCalledTimes(1);
    });

    it('matches the attribute name case-insensitively', () => {
      expect(
        finalizeAttribute({
          element: el('<div DATA-PRIVACY="mask"></div>', 'div'),
          name: 'DATA-PRIVACY',
          value: 'mask',
          privacy: strict,
          maskAllElementAttributes: true,
        }),
      ).toBe('mask');
    });
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

  /**
   * The `isGenerated` flag alone is one point of failure: a mis-set flag on a
   * page-authored attribute would leak it verbatim. The exemption is gated on
   * a fixed rendering-metadata name allowlist as well, so both must agree.
   */
  it('the isGenerated flag alone does not exempt a page attribute name', () => {
    expect(
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: 'Bob',
        privacy: undefined,
        maskAllElementAttributes: true,
        isGenerated: true,
      }),
    ).toBe('***');
    // ... and the policy path is reached too, not just the kill switch
    expect(
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: 'Bob',
        privacy: balanced,
        isGenerated: true,
      }),
    ).toBe('***');
  });

  it('rr_dataURL is not on the allowlist even when flagged generated', () => {
    // it holds real page pixels, unlike rr_width/rr_scrollTop/...
    expect(
      finalizeAttribute({
        element: el(),
        name: 'rr_dataURL',
        value: 'data:image/png;base64,AAA',
        privacy: strict,
        maskAllElementAttributes: true,
        isGenerated: true,
      }),
    ).toBe('*'.repeat('data:image/png;base64,AAA'.length));
  });

  it('every rendering-metadata name the serializer generates is exempt', () => {
    for (const name of [
      'rr_width',
      'rr_height',
      'rr_scrollLeft',
      'rr_scrollTop',
      'rr_mediaState',
      'rr_open_mode',
    ]) {
      expect(
        finalizeAttribute({
          element: el(),
          name,
          value: 'v',
          privacy: strict,
          maskAllElementAttributes: true,
          isGenerated: true,
        }),
      ).toBe('v');
    }
  });

  /**
   * An unmask ancestor is an explicit "this subtree is safe" statement, and
   * escapes the preset's masked-attribute defaults -- Sentry's
   * `maskAttribute` consults its unmask selector the same way.
   */
  it('an unmask ancestor escapes the masked-attribute defaults', () => {
    expect(
      finalizeAttribute({
        element: el('<img title="Bob" class="rr-unmask">'),
        name: 'title',
        value: 'Bob',
        privacy: balanced,
      }),
    ).toBe('Bob');
    expect(
      finalizeAttribute({
        element: el('<div class="rr-unmask"><img title="Bob"></div>'),
        name: 'title',
        value: 'Bob',
        privacy: balanced,
      }),
    ).toBe('Bob');
    expect(
      finalizeAttribute({
        element: el('<img title="Bob">'),
        name: 'title',
        value: 'Bob',
        privacy: balanced,
      }),
    ).toBe('***');
  });

  it('a selector that throws grants no unmask escape; the attribute stays masked', () => {
    const matches = vi
      .spyOn(Element.prototype, 'matches')
      .mockImplementation(() => {
        throw new Error('boom');
      });
    expect(
      finalizeAttribute({
        element: el('<img title="Bob" class="rr-unmask">'),
        name: 'title',
        value: 'Bob',
        privacy: balanced,
      }),
    ).toBe('***');
    matches.mockRestore();
  });

  /**
   * Attributes resolve exactly like text: the nearest annotated ancestor
   * decides, and on the same element mask beats unmask. Before this, the
   * attribute path consulted only the unmask selector, so an unmask ancestor
   * revealed `title`/`placeholder`/`aria-label` through a nearer mask marker
   * that text masking would have honored.
   */
  it('same element carrying mask and unmask keeps the attribute masked', () => {
    expect(
      finalizeAttribute({
        element: el('<img title="Bob" class="rr-mask rr-unmask">'),
        name: 'title',
        value: 'Bob',
        privacy: balanced,
      }),
    ).toBe('***');
  });

  it('the nearest annotated ancestor decides for attributes too', () => {
    expect(
      finalizeAttribute({
        element: el(
          '<div class="rr-unmask"><div class="rr-mask"><img title="Bob"></div></div>',
        ),
        name: 'title',
        value: 'Bob',
        privacy: balanced,
      }),
    ).toBe('***');
    expect(
      finalizeAttribute({
        element: el(
          '<div class="rr-mask"><div class="rr-unmask"><img title="Bob"></div></div>',
        ),
        name: 'title',
        value: 'Bob',
        privacy: balanced,
      }),
    ).toBe('Bob');
  });

  it('under strict the mask-everything default does not join the attribute tie', () => {
    expect(
      finalizeAttribute({
        element: el('<div class="rr-unmask"><img title="Bob"></div>'),
        name: 'title',
        value: 'Bob',
        privacy: strict,
      }),
    ).toBe('Bob');
  });

  it('a record()-level maskTextSelector takes part in the attribute tie', () => {
    const ctx = resolvePrivacyContext({
      privacyPolicy: { version: 1, preset: 'balanced' },
      maskTextSelector: '.widget',
    });
    expect(
      finalizeAttribute({
        element: el(
          '<div class="rr-unmask"><div class="widget"><img title="Bob"></div></div>',
        ),
        name: 'title',
        value: 'Bob',
        privacy: ctx.privacy,
      }),
    ).toBe('***');
  });

  it('honors a record()-level unmaskTextSelector, not just policy selectors', () => {
    document.body.innerHTML =
      '<div class="support-widget"><img title="Bob"></div>' +
      '<div class="rr-unmask"><img title="Alice"></div>' +
      '<div class="policy-safe"><img title="Carol"></div>' +
      '<img title="Dave">';

    const out = JSON.stringify(
      snapshot(document, {
        privacyPolicy: {
          version: 1,
          preset: 'balanced',
          rules: [
            {
              target: { type: 'selector', selector: '.policy-safe' },
              action: 'unmask',
            },
          ],
        },
        unmaskTextSelector: '.support-widget',
      }),
    );

    expect(out).toContain('"Bob"'); // record()-level option
    expect(out).toContain('"Alice"'); // .rr-unmask
    expect(out).toContain('"Carol"'); // policy rule
    expect(out).not.toContain('"Dave"'); // no escape -> still starred
  });

  it('the unmask escape cannot reopen a blocked media source', () => {
    expect(
      finalizeAttribute({
        element: el('<img class="rr-unmask" src="https://a.com/i.png">'),
        name: 'src',
        value: 'https://a.com/i.png',
        privacy: strict,
      }),
    ).toBeNull();
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
    // Under minimal the policy block is the identity, so the callback's output
    // survives verbatim.
    expect(
      finalizeAttribute({
        element: el(),
        name: 'title',
        value: 'Bob',
        privacy: minimal,
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
    // On the branches that do not drop it, an emptied value stays empty.
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
        privacy: minimal,
        maskAttributeFn: () => undefined as unknown as string,
      }),
    ).toBe('***');
    expect(
      finalizeAttribute({
        element: el(),
        name: 'data-x',
        value: 'a longer value',
        privacy: undefined,
        maskAttributeFn: () => ({ nope: true } as unknown as string),
      }),
    ).toBe('*'.repeat('a longer value'.length));
  });

  it('applies the strict media-source rule to the renamed rr_src', () => {
    const iframe = () => el('<iframe src="https://x.com/"></iframe>', 'iframe');
    expect(
      finalizeAttribute({
        element: iframe(),
        name: 'rr_src',
        value: 'https://u:p@x.com/?token=t',
        privacy: strict,
      }),
    ).toBeNull();
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
   * same policy weight as `src` -- otherwise `strict`'s media-source drop
   * would miss it and the frame URL would ride out of the recording verbatim.
   */
  function serializeOpaqueIframe(
    src: string,
    privacyPolicy: PrivacyPolicy,
  ): string {
    document.body.innerHTML = `<iframe src="${src}"></iframe>`;
    // jsdom hands out a blank contentDocument for every iframe; a real
    // cross-origin frame has none, which is what triggers the rr_src rename.
    Object.defineProperty(
      document.querySelector('iframe')!,
      'contentDocument',
      {
        value: null,
      },
    );
    return JSON.stringify(snapshot(document, { privacyPolicy }));
  }

  it('drops the renamed rr_src of a cross-origin iframe under strict', () => {
    const out = serializeOpaqueIframe('https://u:p@x.com/?token=t', {
      version: 1,
      preset: 'strict',
    });
    expect(out).toContain('"rr_src":null');
    expect(out).not.toContain('x.com');
  });
});

/**
 * The `selected` flag on an `<option>` discloses the parent `<select>`'s
 * value without that value ever passing through `maskInput`. The decision
 * used to read `maskInputOptions['select']` alone, so a `balanced`/`strict`
 * policy -- which masks every input value -- still recorded which option the
 * user had chosen.
 */
describe('<option selected> follows the select value decision', () => {
  const OPTIONS =
    '<select><option value="a">A</option><option value="b" selected>B</option></select>';

  it('balanced does not record which option is selected', () => {
    const out = serialize(OPTIONS, { version: 1, preset: 'balanced' });
    expect(out).not.toContain('"selected"');
  });

  it('strict does not record which option is selected', () => {
    const out = serialize(OPTIONS, { version: 1, preset: 'strict' });
    expect(out).not.toContain('"selected"');
  });

  it('minimal with no input masking still records it', () => {
    const out = serialize(OPTIONS, { version: 1, preset: 'minimal' });
    expect(out).toContain('"selected":true');
  });

  it('minimal honors maskInputOptions.select exactly as before', () => {
    document.body.innerHTML = OPTIONS;
    const out = JSON.stringify(
      snapshot(document, { maskAllInputs: { select: true } }),
    );
    expect(out).not.toContain('"selected"');
  });
});
