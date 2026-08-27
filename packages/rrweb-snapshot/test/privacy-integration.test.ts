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
      '<div data-privacy="allow" class="rr-mask"><p>tie broken</p></div>',
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

  it('detectors occlude every input value at snapshot time, clean or not', () => {
    const withDetectors: PrivacyPolicy = {
      version: 1,
      preset: 'legacy',
      detectors: { email: true },
    };
    const out = serialize(
      '<input type="text" value="bob@example.com">' +
        '<input type="text" value="Visible Name">',
      withDetectors,
    );
    expect(out).not.toContain('bob@example.com');
    expect(out).toContain('*'.repeat('bob@example.com'.length));
    // The clean value is occluded too: input values are never scanned, so
    // "no detector matched" is not a reason to record one.
    expect(out).not.toContain('Visible Name');
    expect(out).toContain('*'.repeat('Visible Name'.length));
  });

  it('an unmask rule cannot reveal an input value while detectors are on', () => {
    const withDetectors: PrivacyPolicy = {
      version: 1,
      preset: 'legacy',
      detectors: { email: true },
      rules: [
        {
          target: { type: 'selector', selector: '.rr-unmask' },
          action: 'allow',
        },
      ],
    };
    const out = serialize(
      '<input class="rr-unmask" type="text" value="Visible Name">',
      withDetectors,
    );
    expect(out).not.toContain('Visible Name');
    expect(out).toContain('*'.repeat('Visible Name'.length));
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
  it('detectors occlude every input value to length, matched or not', () => {
    const withDetectors = compilePrivacyPolicy({
      version: 1,
      preset: 'legacy',
      detectors: { email: true },
    });
    expect(withDetectors.maskAllInputs).toBe(true);
    expect(
      maskInput({
        element: input(),
        tagName: 'input',
        type: 'text',
        value: 'bob@example.com',
        maskInputOptions: {},
        privacy: withDetectors,
      }),
    ).toBe('*'.repeat('bob@example.com'.length));
    // A value no detector matches is occluded just the same: input values are
    // never scanned, so a clean scan is never the reason one gets recorded.
    expect(
      maskInput({
        element: input(),
        tagName: 'input',
        type: 'text',
        value: 'plain',
        maskInputOptions: {},
        privacy: withDetectors,
      }),
    ).toBe('*****');
  });
  it('every keystroke prefix is occluded at its own length', () => {
    // The leak this replaced: a value scanned per input event records every
    // prefix shorter than the first Luhn-valid length verbatim.
    const withDetectors = compilePrivacyPolicy({
      version: 1,
      preset: 'legacy',
      detectors: { paymentCard: true },
    });
    const card = '4111111111111111';
    for (let i = 1; i <= card.length; i++) {
      expect(
        maskInput({
          element: input(),
          tagName: 'input',
          type: 'text',
          value: card.slice(0, i),
          maskInputOptions: {},
          privacy: withDetectors,
        }),
      ).toBe('*'.repeat(i));
    }
  });
  it('a maskInputFn controls length only while detectors are on', () => {
    // Under a bare legacy policy the fn's output is trusted verbatim; with
    // detectors active the policy forces the balanced/strict posture, so the
    // fn keeps its say over length and loses its say over content.
    const withDetectors = compilePrivacyPolicy({
      version: 1,
      preset: 'legacy',
      detectors: { email: true },
    });
    expect(
      maskInput({
        element: input(),
        tagName: 'input',
        type: 'text',
        value: 'bob@example.com',
        maskInputOptions: { text: true },
        maskInputFn: () => '[redacted]',
        privacy: withDetectors,
      }),
    ).toBe('*'.repeat('[redacted]'.length));
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

    /**
     * A placeholder is only derivable from *pixels*. Percentages, keywords and
     * a half-declared element are all rejected rather than guessed at, because
     * `finalizeAttribute` may not measure -- it runs per attribute in the
     * serializer's hot path.
     */
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
          element: el('<div data-privacy="allow"></div>', 'div'),
          name: 'data-privacy',
          value: 'allow',
          privacy: strict,
          maskAttributeFn,
        }),
      ).toBe('allow');
      expect(maskAttributeFn).not.toHaveBeenCalled();
      // ...but it still runs for an ordinary attribute on the same element
      finalizeAttribute({
        element: el('<div data-privacy="allow" title="x"></div>', 'div'),
        name: 'title',
        value: 'x',
        privacy: legacy,
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
    // no unmask ancestor -> unchanged behavior
    expect(
      finalizeAttribute({
        element: el('<img title="Bob">'),
        name: 'title',
        value: 'Bob',
        privacy: balanced,
      }),
    ).toBe('***');
  });

  /**
   * `finalizeAttribute` reads the *compiled policy's* `unmaskTextSelector`,
   * so the `record()`-level string option has to be written back onto the
   * policy by `snapshot()`/`record()`. Without that write-back the option
   * would silently only affect text, and the documented attribute escape
   * would not exist for it.
   */
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
              action: 'allow',
            },
          ],
        },
        unmaskTextSelector: '.support-widget',
      }),
    );

    expect(out).toContain('"Bob"'); // record()-level option
    expect(out).toContain('"Alice"'); // vendor class
    expect(out).toContain('"Carol"'); // policy rule
    expect(out).not.toContain('"Dave"'); // no escape -> still starred
  });

  it('the unmask escape cannot reopen a URL or a blocked media source', () => {
    expect(
      finalizeAttribute({
        element: el('<img class="rr-unmask" src="https://a.com/?token=t">'),
        name: 'src',
        value: 'https://a.com/?token=t',
        privacy: balanced,
      }),
    ).toBe('https://a.com/?token=*');
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
        maskAttributeFn: () => ({ nope: true } as unknown as string),
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
    Object.defineProperty(
      document.querySelector('iframe')!,
      'contentDocument',
      {
        value: null,
      },
    );
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

  /**
   * Detectors force `maskAllInputs` whatever the preset, so the flag has to
   * follow even on a `legacy` base.
   */
  it('an active detector suppresses it even under legacy', () => {
    const out = serialize(OPTIONS, {
      version: 1,
      preset: 'legacy',
      detectors: { email: true },
    });
    expect(out).not.toContain('"selected"');
  });

  it('legacy with no input masking still records it', () => {
    const out = serialize(OPTIONS, { version: 1, preset: 'legacy' });
    expect(out).toContain('"selected":true');
  });

  it('legacy honors maskInputOptions.select exactly as before', () => {
    document.body.innerHTML = OPTIONS;
    const out = JSON.stringify(
      snapshot(document, { maskAllInputs: { select: true } }),
    );
    expect(out).not.toContain('"selected"');
  });
});
