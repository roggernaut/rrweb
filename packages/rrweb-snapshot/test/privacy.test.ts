/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  compilePrivacyPolicy,
  validateSelector,
  mergeSelectors,
  resolvePrivacyContext,
  sanitizeUrl,
  splitSelectorList,
  resolveTextValue,
  isEventIgnored,
  VENDOR_COMPAT,
} from '../src/privacy';
import snapshot, {
  _isBlockedElement,
  needMaskingText,
  splitMaskAllSelector,
} from '../src/snapshot';

describe('block decisions fail closed', () => {
  it('blocks the element and warns once when the block selector throws while matching', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    const matches = vi.spyOn(el, 'matches').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(_isBlockedElement(el, 'rr-block', '.x')).toBe(true);
    expect(_isBlockedElement(el, 'rr-block', '.x')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('block');
    matches.mockRestore();
    warn.mockRestore();
  });

  it('does not block when nothing matches and nothing throws', () => {
    const el = document.createElement('div');
    expect(_isBlockedElement(el, 'rr-block', '.x')).toBe(false);
  });
});

describe('compilePrivacyPolicy v2', () => {
  it('minimal preset compiles to inert options', () => {
    const c = compilePrivacyPolicy(undefined);
    expect(c.preset).toBe('minimal');
    expect(c.maskTextSelector).toBeNull();
    expect(c.blockSelector).toBeNull();
    expect(c.maskAllInputs).toBe(false);
    expect([...c.maskedAttributes]).toEqual([]);
    expect(c.attributePolicyInert).toBe(true);
    expect(c.sanitizeUrls).toBe(false);
  });
  it('balanced masks inputs, attributes and URLs but not text', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
    expect(c.maskAllInputs).toBe(true);
    expect([...c.maskedAttributes]).toEqual([
      'title',
      'placeholder',
      'aria-label',
    ]);
    expect(c.sanitizeUrls).toBe(true);
    expect(c.maskTextSelector).not.toContain('*');
    expect(c.maskTextSelector).toContain('[data-privacy]');
    expect(c.maskTextSelector).toContain('.rr-mask');
    expect(c.blockSelector).toContain('[data-privacy="block"]');
    expect(c.blockSelector).toContain('.rr-block');
    expect(c.attributePolicyInert).toBe(false);
  });
  it('strict masks all text and blocks media', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'strict' });
    expect(c.maskTextSelector).toBe('*');
    expect(c.blockMedia).toBe(true);
  });
  it('compiles rules into selector lists', () => {
    const c = compilePrivacyPolicy({
      version: 1,
      preset: 'balanced',
      rules: [
        { target: { type: 'selector', selector: '.pii' }, action: 'mask' },
        { target: { type: 'selector', selector: '.safe' }, action: 'unmask' },
        { target: { type: 'selector', selector: '.gone' }, action: 'block' },
      ],
    });
    expect(c.maskTextSelector).toContain('.pii');
    expect(c.unmaskTextSelector).toContain('.safe');
    expect(c.blockSelector).toContain('.gone');
  });
  it('rejects a pre-v2 action name outright', () => {
    for (const action of ['allow', 'exclude']) {
      expect(() =>
        compilePrivacyPolicy({
          version: 1,
          preset: 'balanced',
          rules: [
            {
              target: { type: 'selector', selector: '.x' },
              action: action as never,
            },
          ],
        }),
      ).toThrow(/Unsupported privacy action/);
    }
  });
  it('drops invalid selectors individually with a warning, keeps the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = compilePrivacyPolicy({
      version: 1,
      preset: 'balanced',
      rules: [
        {
          target: { type: 'selector', selector: ':::garbage' },
          action: 'block',
        },
        { target: { type: 'selector', selector: '.valid' }, action: 'block' },
      ],
    });
    expect(c.blockSelector).toContain('.valid');
    expect(c.blockSelector).not.toContain(':::garbage');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(':::garbage'));
    warn.mockRestore();
  });
  it('throws on bad version/preset/empty selector', () => {
    expect(() =>
      compilePrivacyPolicy({ version: 2 as never, preset: 'minimal' }),
    ).toThrow();
    expect(() =>
      compilePrivacyPolicy({ version: 1, preset: 'custom' as never }),
    ).toThrow();
    expect(() =>
      compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        rules: [{ target: { type: 'selector', selector: '' }, action: 'mask' }],
      }),
    ).toThrow();
  });
  it('precomputes lowercased query parameter sets', () => {
    const c = compilePrivacyPolicy({
      version: 1,
      preset: 'strict',
      url: { blockedQueryParameters: ['SessionID'] },
    });
    expect(c.blockedQueryParameters.has('sessionid')).toBe(true);
    expect(c.blockedQueryParameters.has('token')).toBe(true); // default list
  });
});
/**
 * `data-privacy` carries a fixed vocabulary. A value outside it is almost
 * always a typo or a value from a future version, and in both cases the author
 * was reaching for protection -- so an unrecognized value masks rather than
 * making no decision. The compiled mask token is the bare attribute minus the
 * two values that mean something else, which is what makes this work without
 * any precedence logic: `[data-privacy="unmask"]` and `[data-privacy="block"]`
 * are excluded from the mask list by construction, and everything else in the
 * attribute's value space falls into it.
 */
describe('an unrecognized data-privacy value fails closed to mask', () => {
  const balanced = compilePrivacyPolicy({ version: 1, preset: 'balanced' });

  function matchesMask(html: string): boolean {
    document.body.innerHTML = html;
    const el = document.querySelector('#t') as HTMLElement;
    return el.matches(balanced.maskTextSelector as string);
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it.each([
    ['a typo', 'masked'],
    ['the empty value', ''],
    ['a value from another vocabulary', 'exclude'],
    ['the reserved input-only value', 'mask-inputs'],
    ['a wrong-case spelling', 'Mask'],
  ])('%s masks', (_name, value) => {
    expect(matchesMask(`<div id="t" data-privacy="${value}"></div>`)).toBe(
      true,
    );
  });

  it('leaves the two recognized non-mask values out of the mask list', () => {
    expect(matchesMask('<div id="t" data-privacy="unmask"></div>')).toBe(false);
    expect(matchesMask('<div id="t" data-privacy="block"></div>')).toBe(false);
    // ...and they still reach their own lists
    document.body.innerHTML =
      '<div id="u" data-privacy="unmask"></div>' +
      '<div id="b" data-privacy="block"></div>';
    expect(
      (document.querySelector('#u') as HTMLElement).matches(
        balanced.unmaskTextSelector as string,
      ),
    ).toBe(true);
    expect(
      (document.querySelector('#b') as HTMLElement).matches(
        balanced.blockSelector as string,
      ),
    ).toBe(true);
  });

  it('recognizes data-privacy="mask" itself', () => {
    expect(matchesMask('<div id="t" data-privacy="mask"></div>')).toBe(true);
  });

  it('does not fire on an element with no data-privacy attribute at all', () => {
    expect(matchesMask('<div id="t"></div>')).toBe(false);
  });

  /**
   * `data-privacy` is a managed-preset feature, full stop. It used to switch
   * itself on under `minimal` as soon as a same-action rule existed -- and
   * only for `mask`/`block`, never `unmask` -- so whether the attribute did
   * anything depended on an unrelated rule. Under `minimal` the rules now
   * compile to their bare selectors and nothing else.
   */
  it('is entirely off under minimal, with or without rules', () => {
    const bare = compilePrivacyPolicy({ version: 1, preset: 'minimal' });
    expect(bare.maskTextSelector).toBeNull();
    expect(bare.blockSelector).toBeNull();
    expect(bare.unmaskTextSelector).toBeNull();

    const withRules = compilePrivacyPolicy({
      version: 1,
      preset: 'minimal',
      rules: [
        { target: { type: 'selector', selector: '.x' }, action: 'mask' },
        { target: { type: 'selector', selector: '.y' }, action: 'block' },
        { target: { type: 'selector', selector: '.z' }, action: 'unmask' },
      ],
    });
    expect(withRules.maskTextSelector).toBe('.x');
    expect(withRules.blockSelector).toBe('.y');
    expect(withRules.unmaskTextSelector).toBe('.z');

    document.body.innerHTML =
      '<div id="m" data-privacy="mask"></div>' +
      '<div id="t" data-privacy="typo"></div>' +
      '<div id="b" data-privacy="block"></div>' +
      '<div id="u" data-privacy="unmask"></div>';
    const matches = (id: string, selector: string | null) =>
      (document.querySelector(`#${id}`) as HTMLElement).matches(
        selector as string,
      );
    expect(matches('m', withRules.maskTextSelector)).toBe(false);
    expect(matches('t', withRules.maskTextSelector)).toBe(false);
    expect(matches('b', withRules.blockSelector)).toBe(false);
    expect(matches('u', withRules.unmaskTextSelector)).toBe(false);
  });

  it('does not merge the native rr-* classes into a minimal policy either', () => {
    const withRules = compilePrivacyPolicy({
      version: 1,
      preset: 'minimal',
      rules: [
        { target: { type: 'selector', selector: '.x' }, action: 'mask' },
        { target: { type: 'selector', selector: '.y' }, action: 'block' },
      ],
    });
    // `.rr-mask`/`.rr-block` reach a `minimal` recording through the separate
    // `maskTextClass`/`blockClass` options, not through the compiled policy.
    expect(withRules.maskTextSelector).not.toContain('.rr-mask');
    expect(withRules.blockSelector).not.toContain('.rr-block');
  });
});

/**
 * `data-privacy="ignore"` is `mask` plus event silence: content masks through
 * the fail-closed mask token (no dedicated mask entry), and the compiled
 * `ignoreSelector` lets the record side suppress the subtree's input events.
 * Severity ladder: unmask < mask < ignore < block, nearest annotation wins.
 */
describe('data-privacy="ignore"', () => {
  const balanced = compilePrivacyPolicy({ version: 1, preset: 'balanced' });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('content is masked by the compiled policy, exactly as mask is', () => {
    document.body.innerHTML =
      '<div id="i" data-privacy="ignore"></div>' +
      '<div id="m" data-privacy="mask"></div>';
    const mask = balanced.maskTextSelector as string;
    expect((document.querySelector('#i') as HTMLElement).matches(mask)).toBe(
      true,
    );
    expect((document.querySelector('#m') as HTMLElement).matches(mask)).toBe(
      true,
    );
  });

  it('compiles an ignoreSelector under managed presets, none under minimal', () => {
    expect(balanced.ignoreSelector).toBe('[data-privacy="ignore"]');
    expect(
      compilePrivacyPolicy({ version: 1, preset: 'strict' }).ignoreSelector,
    ).toBe('[data-privacy="ignore"]');
    expect(
      compilePrivacyPolicy({ version: 1, preset: 'minimal' }).ignoreSelector,
    ).toBeNull();
  });

  it('isEventIgnored: the nearest data-privacy annotation decides', () => {
    document.body.innerHTML =
      '<div data-privacy="ignore"><input id="in-ignore">' +
      '<div data-privacy="unmask"><input id="in-unmask"></div>' +
      '<div data-privacy="mask"><input id="in-mask"></div></div>' +
      '<input id="outside">';
    const el = (id: string) => document.querySelector(`#${id}`) as HTMLElement;
    expect(isEventIgnored(el('in-ignore'), balanced)).toBe(true);
    expect(isEventIgnored(el('in-unmask'), balanced)).toBe(false);
    expect(isEventIgnored(el('in-mask'), balanced)).toBe(false);
    expect(isEventIgnored(el('outside'), balanced)).toBe(false);
  });

  it('isEventIgnored is inert under minimal, where data-privacy is off', () => {
    document.body.innerHTML = '<div data-privacy="ignore"><input id="t"></div>';
    const minimal = compilePrivacyPolicy({ version: 1, preset: 'minimal' });
    expect(
      isEventIgnored(document.querySelector('#t') as HTMLElement, minimal),
    ).toBe(false);
    expect(
      isEventIgnored(document.querySelector('#t') as HTMLElement, undefined),
    ).toBe(false);
  });
});

/**
 * Recognizing another tool's classes changes what rrweb records based on
 * markup the embedder may not control, so it is an explicit opt-in rather
 * than a managed-preset default.
 */
describe('vendorCompat', () => {
  const off = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
  const on = compilePrivacyPolicy({
    version: 1,
    preset: 'balanced',
    vendorCompat: true,
  });

  it('is off by default: only rrweb-native conventions are merged', () => {
    expect(off.maskTextSelector).toContain('.rr-mask');
    expect(off.blockSelector).toContain('.rr-block');
    expect(off.unmaskTextSelector).toContain('.rr-unmask');
    for (const foreign of [
      '.ph-mask',
      '.mp-mask',
      '.fs-mask',
      '.amp-mask',
      '.sentry-mask',
      '[data-sentry-mask]',
      '.dd-privacy-mask',
      '[data-nr-mask]',
    ])
      expect(off.maskTextSelector).not.toContain(foreign);
    for (const foreign of [
      '.ph-no-capture',
      '.mp-block',
      '.fs-exclude',
      '.amp-block',
      '.sentry-block',
      '.dd-privacy-hidden',
      '[data-nr-block]',
    ])
      expect(off.blockSelector).not.toContain(foreign);
  });

  it('merges the foreign mask and block tokens when enabled', () => {
    expect(on.maskTextSelector).toContain('.ph-mask');
    expect(on.maskTextSelector).toContain('.dd-privacy-mask'); // Datadog
    expect(on.maskTextSelector).toContain('[data-nr-mask]'); // New Relic
    expect(on.maskTextSelector).toContain('.sentry-mask');
    expect(on.blockSelector).toContain('.dd-privacy-hidden'); // Datadog
    expect(on.blockSelector).toContain('[data-nr-block]'); // New Relic
    expect(on.blockSelector).toContain('.sentry-block');
    // native tokens are still there alongside them
    expect(on.maskTextSelector).toContain('.rr-mask');
    expect(on.blockSelector).toContain('.rr-block');
  });

  it("recognizes both of Sentry's block spellings, class and attribute", () => {
    // Sentry ships `.sentry-block` and `[data-sentry-block]` as defaults
    // (getPrivacyOptions.ts); recognizing the class alone left the attribute
    // form unprotected under vendorCompat.
    expect(on.blockSelector).toContain('.sentry-block');
    expect(on.blockSelector).toContain('[data-sentry-block]');
  });

  it("recognizes FullStory's consent-gated variants as plain mask/exclude", () => {
    // "without consent" means masked/excluded until FullStory's own consent
    // API reveals them; rrweb has no such API, so they are always honored.
    expect(on.maskTextSelector).toContain('.fs-mask-without-consent');
    expect(on.blockSelector).toContain('.fs-exclude-without-consent');
  });

  /**
   * The extended vendor set. Every token here was verified against the
   * vendor's official documentation or open-source SDK (see guide.md's
   * "Vendor class recognition" table). Mapping rule: a token whose vendor
   * semantics hide only text joins the mask list; one that removes or
   * placeholders the element's whole content (images, children) joins the
   * block list, the more protective of the two.
   */
  const extendedMask = [
    '.highlight-mask', // Highlight / LaunchDarkly
    '[data-clarity-mask]', // Microsoft Clarity
    '[data-sl="mask"]', // Smartlook
    '[data-openreplay-obscured]', // OpenReplay
    '[data-openreplay-masked]', // OpenReplay (deprecated alias, still honored)
    '[data-cs-encrypt]', // Contentsquare (encrypted capture; masked here)
    '[data-mf-replace-inner]', // Mouseflow (inner text replaced, structure kept)
    '.inspectlet-sensitive', // Inspectlet
    '.inspectletIgnore', // Inspectlet
    '[data-dtrum-mask]', // Dynatrace
    '[data-qm-encrypt]', // Quantum Metric (encrypted capture there; masked here)
    '.cls_mask', // Glassbox (observed-only; docs are customer-gated)
    '.sessionstack-sensitive', // SessionStack
    '[data-recording-sensitive]', // Smartlook legacy (masked there; also events-ignored)
  ];
  const extendedBlock = [
    '.highlight-block', // Highlight / LaunchDarkly
    '[data-private]', // LogRocket (any value)
    '._lr-hide', // LogRocket (legacy)
    '[data-hj-suppress]', // Hotjar (attribute form; images placeholdered there)
    '.data-hj-suppress', // Hotjar (class form, also documented)
    '[data-sl="exclude"]', // Smartlook
    '[data-openreplay-hidden]', // OpenReplay
    '[data-openreplay-htmlmasked]', // OpenReplay (deprecated alias)
    '[data-cs-mask]', // Contentsquare (content removed from collection)
    '[data-heap-redact-text]', // Heap (whole element redacted in their replay)
    '[data-heap-redact-attributes]', // Heap (whole element redacted in their replay)
    '.mf-masked', // Mouseflow ("not recorded at all" there)
    '[data-mf-replace]', // Mouseflow (subtree swapped for placeholder value)
    '.mf-excluded', // Mouseflow
    '.lo-sensitive', // Lucky Orange (text scrambled, images blanked)
    '.losensitive', // Lucky Orange (alias)
    '.userback-block', // Userback
    '.zipy-block', // Zipy
    '[data-qm-block]', // Quantum Metric (customer-config convention)
    '[data-qm-freeze-exclude]', // Quantum Metric (DOM-capture exclude)
    '[data-recording-disable]', // Smartlook legacy
    '[data-sr-redact]', // Session Rewind ("exclude"; rendering unspecified there)
  ];
  // Reveal tokens are never merged anywhere; ignore-like tokens listed here
  // are the ones with no verified events-only semantics, so they stay
  // unmerged too. (`.highlight-ignore` moved to ignoreEvents once its
  // events-only behavior was verified from the highlight-run source.)
  const foreignRevealOrIgnore = [
    '[data-hl-record]',
    '[data-public]',
    '[data-hj-allow]',
    '.data-hj-allow',
    '[data-clarity-unmask]',
    '[data-sl="unmask"]',
    '[data-openreplay-unmask]',
    '[data-cs-capture]',
    '.lo-not-sensitive',
    '.lonotsensitive',
    '[data-dtrum-allow]',
    '.mf-listen',
    '[data-qm-allow]',
    '[data-recording-ignore]',
    '.smartlook-hide',
    '.smartlook-show',
    '.heap-ignore', // documented only as the attribute; the class has no evidence
  ];

  it('recognizes the extended vendor set as mask or block', () => {
    for (const token of extendedMask)
      expect(on.maskTextSelector).toContain(token);
    for (const token of extendedBlock)
      expect(on.blockSelector).toContain(token);
  });

  it('never merges a foreign reveal token, on either setting', () => {
    for (const token of foreignRevealOrIgnore) {
      for (const list of [
        on.maskTextSelector,
        on.blockSelector,
        on.unmaskTextSelector,
        on.ignoreEventsSelector,
        off.maskTextSelector,
        off.blockSelector,
        off.unmaskTextSelector,
        off.ignoreEventsSelector,
      ])
        expect(list ?? '').not.toContain(token);
    }
  });

  /**
   * A vendor ignore token is events-only there, so it compiles into the
   * events-only `ignoreEventsSelector` and never into mask, block, or
   * unmask — an element carrying one keeps its recorded content.
   */
  describe('ignoreEvents tokens', () => {
    const ignoreTokens = [
      '.sentry-ignore',
      '[data-sentry-ignore]',
      '.ph-ignore-input',
      '.nr-ignore',
      '.highlight-ignore',
      '[heap-ignore]', // autocapture-event suppression only there
      '.userback-ignore', // element rendered, its user input ignored there
      '[data-recording-sensitive]', // Smartlook legacy: masked AND events-ignored
    ];
    // Every ignore token except Smartlook's legacy dual-slot one, which is
    // deliberately in the mask list too (it masked text there as well).
    const eventsOnlyTokens = ignoreTokens.filter(
      (token) => token !== '[data-recording-sensitive]',
    );

    it('compiles the vendor ignore tokens into ignoreEventsSelector', () => {
      for (const token of ignoreTokens)
        expect(on.ignoreEventsSelector).toContain(token);
      expect(off.ignoreEventsSelector).toBeNull();
      expect(
        compilePrivacyPolicy({
          version: 1,
          preset: 'minimal',
          vendorCompat: true,
        }).ignoreEventsSelector,
      ).toBeNull();
    });

    it('never leaks an events-only token into mask, block, or unmask', () => {
      for (const token of eventsOnlyTokens) {
        expect(on.maskTextSelector ?? '').not.toContain(token);
        expect(on.blockSelector ?? '').not.toContain(token);
        expect(on.unmaskTextSelector ?? '').not.toContain(token);
      }
      // The dual-slot exception is mask + ignore, never unmask or block.
      expect(on.maskTextSelector).toContain('[data-recording-sensitive]');
      expect(on.unmaskTextSelector ?? '').not.toContain(
        '[data-recording-sensitive]',
      );
    });

    it('an array compiles only the named vendors ignore tokens', () => {
      const sentryOnly = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: ['sentry'],
      });
      expect(sentryOnly.ignoreEventsSelector).toContain('.sentry-ignore');
      expect(sentryOnly.ignoreEventsSelector).toContain('[data-sentry-ignore]');
      expect(sentryOnly.ignoreEventsSelector ?? '').not.toContain(
        '.ph-ignore-input',
      );
      const posthogOnly = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: ['posthog'],
      });
      expect(posthogOnly.ignoreEventsSelector).toBe('.ph-ignore-input');
      const datadogOnly = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: ['datadog'],
      });
      // Datadog has no customer-facing ignore token (its IGNORE level is
      // internal to the SDK); nothing compiles here.
      expect(datadogOnly.ignoreEventsSelector).toBeNull();
    });

    it('isEventIgnored: matches on the annotated element itself, not ancestors', () => {
      document.body.innerHTML =
        '<input id="self" class="sentry-ignore">' +
        '<div class="sentry-ignore"><input id="nested"></div>';
      const sentry = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: ['sentry'],
      });
      const el = (id: string) =>
        document.querySelector(`#${id}`) as HTMLElement;
      // Element-matched, mirroring the vendors' own input observers, which
      // test the event target only.
      expect(isEventIgnored(el('self'), sentry)).toBe(true);
      expect(isEventIgnored(el('nested'), sentry)).toBe(false);
      // Another vendor's compat does not honor the token.
      const posthog = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: ['posthog'],
      });
      expect(isEventIgnored(el('self'), posthog)).toBe(false);
    });

    it('suppresses events only: an ignore-annotated element is not masked', () => {
      document.body.innerHTML = '<p id="t" class="sentry-ignore">text</p>';
      const sentry = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: ['sentry'],
      });
      const el = document.querySelector('#t') as HTMLElement;
      expect(isEventIgnored(el, sentry)).toBe(true);
      expect(el.matches(sentry.maskTextSelector as string)).toBe(false);
      expect(el.matches(sentry.blockSelector as string)).toBe(false);
    });

    it('a throwing matches() fails closed to suppression', () => {
      const sentry = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: ['sentry'],
      });
      const el = document.createElement('input');
      vi.spyOn(el, 'matches').mockImplementation(() => {
        throw new Error('boom');
      });
      expect(isEventIgnored(el, sentry)).toBe(true);
    });
  });

  /**
   * The registry-wide monotonicity invariant, pinned statically: no vendor
   * entry — mask, block, or ignoreEvents — may carry a selector that could
   * reveal content. Checked both against the vendors' known allow/unmask
   * vocabularies and against the generic substrings those vocabularies use,
   * so a future entry that smuggles one in fails here regardless of vendor.
   */
  it('no registry entry carries an allow/unmask-like selector, in any slot', () => {
    const revealSubstrings = ['unmask', 'unblock', 'allow'];
    const knownRevealTokens = [
      '[data-hl-record]',
      '[data-public]',
      '[data-hj-allow]',
      '.data-hj-allow',
      '[data-clarity-unmask]',
      '[data-sl="unmask"]',
      '[data-openreplay-unmask]',
      '[data-cs-capture]',
      '.lo-not-sensitive',
      '.lonotsensitive',
      '.smartlook-show',
      '.mf-listen',
      '.ph-include',
    ];
    for (const [vendor, entry] of Object.entries(VENDOR_COMPAT)) {
      const selectors = [
        ...entry.mask,
        ...entry.block,
        ...(entry.ignoreEvents ?? []),
      ];
      for (const selector of selectors) {
        const lower = selector.toLowerCase();
        for (const substring of revealSubstrings)
          expect(
            lower.includes(substring),
            `${vendor}: ${selector} looks like a reveal token`,
          ).toBe(false);
        expect(
          knownRevealTokens.includes(selector),
          `${vendor}: ${selector} is a known reveal token`,
        ).toBe(false);
      }
    }
  });

  it('every compat token is a valid selector and survives the merge', () => {
    // A typo in the list would be dropped with a warning at compile time
    // and silently protect nothing; this pins the whole list as valid.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    compilePrivacyPolicy({
      version: 1,
      preset: 'balanced',
      vendorCompat: true,
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    for (const token of [...extendedMask, ...extendedBlock])
      expect(validateSelector(token)).toBe(true);
  });

  it('warns when vendorCompat is set under minimal, where it has no effect', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    compilePrivacyPolicy({ version: 1, preset: 'minimal', vendorCompat: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vendorCompat'));
    warn.mockClear();
    compilePrivacyPolicy({
      version: 1,
      preset: 'balanced',
      vendorCompat: true,
    });
    compilePrivacyPolicy({ version: 1, preset: 'minimal' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  /**
   * `vendorCompat` may only ever add masking or blocking, never reveal:
   * `.rr-unmask` is the only unmask token, on or off. No foreign tool's
   * unmask/allow convention is ever honored, regardless of the flag —
   * enabling compat cannot turn a foreign marker into an unmask signal.
   */
  it('never honors a foreign unmask token, flag on or off', () => {
    expect(on.unmaskTextSelector).toContain('.rr-unmask');
    for (const foreign of [
      '.amp-unmask',
      '.sentry-unmask',
      '.dd-privacy-allow',
      '[data-dd-privacy="allow"]',
      '.nr-unmask',
      '.ph-no-mask',
      '.fs-unmask',
      '.mp-unmask',
    ]) {
      expect(on.unmaskTextSelector).not.toContain(foreign);
      expect(off.unmaskTextSelector).not.toContain(foreign);
    }
  });

  it('stays inert under minimal, which never merged vendor classes', () => {
    const c = compilePrivacyPolicy({
      version: 1,
      preset: 'minimal',
      vendorCompat: true,
    });
    expect(c.maskTextSelector).toBeNull();
    expect(c.blockSelector).toBeNull();
  });

  /**
   * `vendorCompat` also takes an array of vendor ids, merging only those
   * vendors' tokens: `true` stays the union of every vendor, `[]` merges
   * none, and an unknown id is dropped with a warning naming it.
   */
  describe('granular vendor selection', () => {
    afterEach(() => {
      document.body.innerHTML = '';
    });

    /** An element carrying `token` (class or attribute form), attached. */
    function elementFor(token: string): HTMLElement {
      const el = document.createElement('div');
      const attr = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(token);
      if (attr) el.setAttribute(attr[1], attr[2] ?? '');
      else el.className = token.slice(1);
      document.body.appendChild(el);
      return el;
    }

    it('true behaves as the full legacy set: every vendor token still matches', () => {
      const coreMask = [
        '.mp-mask',
        '.fs-mask',
        '.fs-mask-without-consent',
        '.amp-mask',
        '.ph-mask',
        '.sentry-mask',
        '[data-sentry-mask]',
        '.dd-privacy-mask',
        '[data-dd-privacy="mask"]',
        '.dd-privacy-mask-user-input',
        '[data-dd-privacy="mask-user-input"]',
        '.nr-mask',
        '[data-nr-mask]',
      ];
      const coreBlock = [
        '.mp-block',
        '.fs-exclude',
        '.fs-exclude-without-consent',
        '.amp-block',
        '.ph-no-capture',
        '.sentry-block',
        '[data-sentry-block]',
        '.dd-privacy-hidden',
        '[data-dd-privacy="hidden"]',
        '.nr-block',
        '[data-nr-block]',
      ];
      for (const token of [...coreMask, ...extendedMask])
        expect(elementFor(token).matches(on.maskTextSelector as string)).toBe(
          true,
        );
      for (const token of [...coreBlock, ...extendedBlock])
        expect(elementFor(token).matches(on.blockSelector as string)).toBe(
          true,
        );
    });

    it('true equals naming every vendor', () => {
      const all = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: [
          'mixpanel',
          'fullstory',
          'amplitude',
          'posthog',
          'sentry',
          'datadog',
          'newrelic',
          'highlight',
          'logrocket',
          'hotjar',
          'clarity',
          'smartlook',
          'openreplay',
          'contentsquare',
          'heap',
          'mouseflow',
          'luckyorange',
          'inspectlet',
          'dynatrace',
          'userback',
          'zipy',
          'quantummetric',
          'glassbox',
          'sessionstack',
          'sessionrewind',
        ],
      });
      expect(all.maskTextSelector).toBe(on.maskTextSelector);
      expect(all.blockSelector).toBe(on.blockSelector);
    });

    it('an array merges only the named vendors', () => {
      const posthogOnly = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: ['posthog'],
      });
      const mask = posthogOnly.maskTextSelector as string;
      expect(elementFor('.ph-mask').matches(mask)).toBe(true);
      expect(elementFor('.mp-mask').matches(mask)).toBe(false);
      expect(posthogOnly.blockSelector).toContain('.ph-no-capture');
      expect(posthogOnly.blockSelector).not.toContain('.mp-block');
    });

    it('an empty array merges no vendor tokens at all', () => {
      const none = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: [],
      });
      expect(none.maskTextSelector).toBe(off.maskTextSelector);
      expect(none.blockSelector).toBe(off.blockSelector);
    });

    it('warns naming an unknown id and skips it, keeping the known ones', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const c = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: ['posthog', 'hotjarr' as never],
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('hotjarr'));
      expect(c.blockSelector).toContain('.ph-no-capture');
      expect(c.maskTextSelector).toContain('.ph-mask');
      warn.mockRestore();
    });

    it('booleans still compile: false merges nothing', () => {
      const asFalse = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: false,
      });
      expect(asFalse.maskTextSelector).toBe(off.maskTextSelector);
      expect(asFalse.blockSelector).toBe(off.blockSelector);
    });

    it('never merges an unmask token under the array form either', () => {
      const named = compilePrivacyPolicy({
        version: 1,
        preset: 'balanced',
        vendorCompat: ['amplitude', 'fullstory', 'datadog'],
      });
      for (const foreign of [
        '.amp-unmask',
        '.fs-unmask',
        '.dd-privacy-allow',
        '[data-dd-privacy="allow"]',
      ]) {
        expect(named.maskTextSelector).not.toContain(foreign);
        expect(named.blockSelector).not.toContain(foreign);
        expect(named.unmaskTextSelector).not.toContain(foreign);
      }
    });
  });
});

describe('validateSelector', () => {
  it('accepts valid, rejects invalid', () => {
    expect(validateSelector('.a > [data-x="1"]')).toBe(true);
    expect(validateSelector(':::nope')).toBe(false);
  });

  /**
   * With no `document` to ask (SSR, a worker, a non-DOM harness) the probe
   * used to throw a `ReferenceError` into the caller's catch and report every
   * selector invalid -- dropping the entire compiled policy, fail-open. The
   * runtime catch-to-mask around `matches()` stays the fail-closed backstop.
   */
  it('assumes valid when there is no document to probe with', () => {
    vi.stubGlobal('document', undefined);
    try {
      expect(validateSelector('.a')).toBe(true);
      expect(validateSelector(':::nope')).toBe(true);
      expect(
        compilePrivacyPolicy({
          version: 1,
          preset: 'minimal',
          rules: [
            { target: { type: 'selector', selector: '.pii' }, action: 'mask' },
          ],
        }).maskTextSelector,
      ).toBe('.pii');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
/**
 * The splitter exists so that merging and deduplicating selector lists never
 * rewrites what a fragment means. Every case here is a comma that is NOT a
 * separator.
 */
describe('splitSelectorList', () => {
  it('splits an ordinary list on its separators', () => {
    expect(splitSelectorList('.a,.b,.c')).toEqual(['.a', '.b', '.c']);
    expect(splitSelectorList('.only')).toEqual(['.only']);
  });

  it('keeps commas nested in a functional pseudo-class', () => {
    expect(splitSelectorList(':is(.a,.b)')).toEqual([':is(.a,.b)']);
    expect(splitSelectorList(':not(.a,.b),.c')).toEqual([':not(.a,.b)', '.c']);
  });

  it('keeps commas inside an attribute value', () => {
    expect(splitSelectorList('[data-x="p,q"]')).toEqual(['[data-x="p,q"]']);
    expect(splitSelectorList("[data-x='p,q'],.c")).toEqual([
      "[data-x='p,q']",
      '.c',
    ]);
  });

  it('keeps an escaped comma, quoted or not', () => {
    expect(splitSelectorList('.a\\,b')).toEqual(['.a\\,b']);
    expect(splitSelectorList('.a\\,b,b')).toEqual(['.a\\,b', 'b']);
    expect(splitSelectorList('[data-x="p\\"q,r"]')).toEqual([
      '[data-x="p\\"q,r"]',
    ]);
  });

  it('does not run past the end on a trailing backslash', () => {
    expect(splitSelectorList('.a\\')).toEqual(['.a\\']);
  });

  // A malformed fragment must only take itself down. Before these cases were
  // handled, a stray closer or an unterminated quote swallowed every later
  // separator, so the valid selectors after it were dropped along with it.
  it('still splits after a stray closing bracket', () => {
    expect(splitSelectorList('.a),.b,.c')).toEqual(['.a)', '.b', '.c']);
    expect(splitSelectorList('.a]),.b')).toEqual(['.a])', '.b']);
  });

  it('still splits after an unterminated quote', () => {
    expect(splitSelectorList('[data-x="unterminated],.b')).toEqual([
      '[data-x="unterminated]',
      '.b',
    ]);
    expect(splitSelectorList(".a',.b")).toEqual([".a'", '.b']);
  });

  it('still splits after an unclosed opener', () => {
    expect(splitSelectorList(':is(.a,.b')).toEqual([':is(.a', '.b']);
    expect(splitSelectorList('[data-x,.b')).toEqual(['[data-x', '.b']);
  });

  it('keeps a balanced list intact once an earlier fragment is malformed', () => {
    expect(splitSelectorList('.a),:is(.b,.c),.d')).toEqual([
      '.a)',
      ':is(.b,.c)',
      '.d',
    ]);
  });
});

describe('malformed fragments do not drop their valid neighbours', () => {
  it('keeps a mask rule that follows a fragment with a stray closer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = compilePrivacyPolicy({
      version: 1,
      preset: 'balanced',
      rules: [
        { target: { type: 'selector', selector: '.a),.b' }, action: 'mask' },
      ],
    });
    expect(c.maskTextSelector).toContain('.b');
    expect(c.maskTextSelector).not.toContain('.a)');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('.a)'));
    warn.mockRestore();
  });
});

describe('resolvePrivacyContext', () => {
  it('joins manual selector with compiled blockSelector', () => {
    const { blockSelector } = resolvePrivacyContext({
      privacyPolicy: { version: 1, preset: 'balanced' },
      blockSelector: '.manual-selector',
    });
    expect(blockSelector).toContain('.manual-selector');
    expect(blockSelector).toContain('[data-privacy="block"]');
  });

  /**
   * `finalizeAttribute` reads the *compiled policy's* `unmaskTextSelector`,
   * so the record()-level option has to be written back onto the policy or it
   * would only ever affect text masking.
   */
  it('writes the merged unmask selector back onto the compiled policy', () => {
    const { privacy, unmaskTextSelector } = resolvePrivacyContext({
      privacyPolicy: { version: 1, preset: 'balanced' },
      unmaskTextSelector: '.mine',
    });
    expect(privacy.unmaskTextSelector).toBe(unmaskTextSelector);
    expect(privacy.unmaskTextSelector).toContain('.mine');
    expect(privacy.unmaskTextSelector).toContain('[data-privacy="unmask"]');
  });

  it('leaves the compiled policy untouched when nothing was merged in', () => {
    const compiled = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
    expect(resolvePrivacyContext({ privacy: compiled }).privacy).toBe(compiled);
  });
});

/**
 * The `record()`-level selector options used to be concatenated onto the
 * compiled policy without ever being probed. One malformed selector then made
 * every downstream `matches()` throw, and the runtime catch-to-mask starred
 * the entire page. They now go through the same drop-and-warn validation as
 * policy rule selectors.
 */
describe('merge helpers validate the record()-level selector', () => {
  const balanced = compilePrivacyPolicy({ version: 1, preset: 'balanced' });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each([
    ['maskTextSelector', balanced.maskTextSelector],
    ['unmaskTextSelector', balanced.unmaskTextSelector],
    ['blockSelector', balanced.blockSelector],
  ])('%s drops an invalid manual half with a warning', (_name, compiled) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const merged = mergeSelectors(':::garbage', compiled);
    expect(merged).not.toContain(':::garbage');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('dropping invalid selector'),
    );
  });

  /**
   * A malformed fragment used to take the whole comma-separated list with
   * it, silently un-masking everything its valid siblings covered -- a
   * fail-open, and the opposite of what the guide promises. Validation now
   * falls back to fragment by fragment.
   */
  it('keeps the valid half of a partly-malformed manual selector', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const merged = mergeSelectors(
      '.pii, .broken:has-typo(',
      balanced.maskTextSelector,
    )!;
    expect(merged).toContain('.pii');
    expect(merged).not.toContain('has-typo');
    expect(merged).toContain('.rr-mask');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('.broken:has-typo('),
    );

    document.body.innerHTML = '<div class="pii">x</div>';
    expect(document.querySelector('div')!.matches(merged)).toBe(true);
  });

  it('names only the dropped fragments in the warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mergeSelectors(':::garbage,.valid', balanced.maskTextSelector);
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain(':::garbage');
    expect(message).not.toContain('.valid');
  });

  it('drops a whole list only when every fragment is malformed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const merged = mergeSelectors(
      ':::a,:::b',
      balanced.maskTextSelector,
    ) as string;
    expect(merged).toBe(balanced.maskTextSelector);
    expect(warn).toHaveBeenCalled();
  });

  it('keeps surviving fragments of a policy rule too, not just the manual half', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const compiled = compilePrivacyPolicy({
      version: 1,
      preset: 'minimal',
      rules: [
        {
          target: { type: 'selector', selector: '.pii, .broken:has-typo(' },
          action: 'mask',
        },
      ],
    });
    expect(compiled.maskTextSelector).toBe('.pii');
    expect(warn).toHaveBeenCalled();
  });

  /**
   * `record()` merges the policy's selectors into the options it hands to
   * `snapshot()`, which compiles the same policy and merges a second time.
   * Without deduplication every fragment would be repeated on each pass.
   */
  it('is idempotent: re-merging an already-merged selector adds nothing', () => {
    const once = mergeSelectors(null, balanced.unmaskTextSelector);
    const twice = mergeSelectors(once, balanced.unmaskTextSelector);
    expect(twice).toBe(once);
    expect(mergeSelectors(twice, balanced.unmaskTextSelector)).toBe(once);
  });

  it('deduplicates a fragment the manual half repeats from the policy', () => {
    const merged = mergeSelectors('.rr-mask,.mine', balanced.maskTextSelector);
    expect(merged!.split(',').filter((p) => p === '.rr-mask')).toHaveLength(1);
    expect(merged).toContain('.mine');
  });

  /**
   * Regression: the splitter used to honor a backslash escape only inside
   * quotes, so `.a\,b` was torn into `.a\` and `b`. The stray `b` then
   * collided in the dedupe `Set` with the independently supplied `b`
   * selector and silently swallowed it -- a dropped mask selector, i.e. a
   * fail-open. Both must survive the merge and still match.
   */
  it('an escaped comma does not swallow an unrelated selector in the dedupe', () => {
    const minimal = compilePrivacyPolicy(undefined);
    const merged = mergeSelectors('.a\\,b,b', minimal.maskTextSelector)!;

    document.body.innerHTML = '<div class="a,b">x</div><b>y</b>';
    const commaClassEl = document.querySelector('div')!;
    const bEl = document.querySelector('b')!;

    expect(commaClassEl.matches(merged)).toBe(true);
    expect(bEl.matches(merged)).toBe(true);
  });

  it('keeps both halves when they arrive from different merge sources', () => {
    // the escaped-comma selector comes in as the record()-level option, the
    // colliding `b` from a policy rule
    const policy = compilePrivacyPolicy({
      version: 1,
      preset: 'minimal',
      rules: [{ target: { type: 'selector', selector: 'b' }, action: 'mask' }],
    });
    const merged = mergeSelectors('.a\\,b', policy.maskTextSelector)!;

    document.body.innerHTML = '<div class="a,b">x</div><b>y</b>';
    expect(document.querySelector('div')!.matches(merged)).toBe(true);
    expect(document.querySelector('b')!.matches(merged)).toBe(true);
  });

  it('does not tear a selector whose commas are nested', () => {
    // a naive split(',') would produce ':is(.a' and '.b)' -- rejoining
    // deduplicated halves of those would corrupt the selector
    const merged = mergeSelectors(
      ':is(.a,.b),[data-x="p,q"]',
      balanced.maskTextSelector,
    );
    expect(merged).toContain(':is(.a,.b)');
    expect(merged).toContain('[data-x="p,q"]');
    expect(() => document.querySelector(merged!)).not.toThrow();
  });

  it('a malformed record()-level maskTextSelector no longer stars the page', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    document.body.innerHTML =
      '<p>keep this text</p><p class="valid">masked text</p>';

    const out = JSON.stringify(
      snapshot(document, {
        privacyPolicy: { version: 1, preset: 'balanced' },
        maskTextSelector: mergeSelectors(
          ':::garbage,.valid',
          balanced.maskTextSelector,
        ),
      }),
    );

    // the malformed fragment neither throws the page into catch-to-mask...
    expect(out).toContain('keep this text');
    // ...nor takes its valid sibling down with it
    expect(out).not.toContain('masked text');
    expect(warn).toHaveBeenCalled();
  });
});

describe('sanitizeUrl v2', () => {
  const strict = compilePrivacyPolicy({ version: 1, preset: 'strict' });
  const balanced = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
  const manual = compilePrivacyPolicy(undefined);
  it('strips userinfo credentials', () => {
    expect(
      sanitizeUrl('https://alice:hunter2@api.example.com/x', balanced),
    ).toBe('https://api.example.com/x');
  });
  it('masks blocked query parameters, case-insensitively', () => {
    expect(sanitizeUrl('https://a.com/?Token=abc&ok=1', balanced)).toBe(
      'https://a.com/?Token=*&ok=1',
    );
  });
  it('strict masks all params unless allowlisted', () => {
    const allow = compilePrivacyPolicy({
      version: 1,
      preset: 'strict',
      url: { allowedQueryParameters: ['page'] },
    });
    expect(sanitizeUrl('https://a.com/?page=2&q=x', strict)).toBe(
      'https://a.com/?page=*&q=*',
    );
    expect(sanitizeUrl('https://a.com/?page=2&q=x', allow)).toBe(
      'https://a.com/?page=2&q=*',
    );
  });
  it('removes hash unless disabled; manual passes through untouched', () => {
    expect(sanitizeUrl('https://a.com/x#frag', balanced)).toBe(
      'https://a.com/x',
    );
    expect(sanitizeUrl('https://alice:pw@a.com/?token=x#f', manual)).toBe(
      'https://alice:pw@a.com/?token=x#f',
    );
  });
  it('unparseable value under non-manual fails closed by dropping the attribute', () => {
    expect(sanitizeUrl('http://[broken', balanced)).toBeNull();
  });
  it('empty in, empty out -- never resolved into a path', () => {
    expect(sanitizeUrl('', balanced)).toBe('');
    expect(sanitizeUrl('', strict)).toBe('');
    expect(sanitizeUrl('', manual)).toBe('');
  });
});

describe('resolveTextValue: exemptScript', () => {
  const script = document.createElement('script');
  it('exempts SCRIPT text from masking when exemptScript is true (the snapshot path)', () => {
    expect(
      resolveTextValue({
        value: 'secret',
        parent: script,
        needsMask: true,
        maskTextFn: undefined,
        exemptScript: true,
      }),
    ).toBe('secret');
  });

  it('masks SCRIPT text like any other node when exemptScript is false (the mutation path)', () => {
    expect(
      resolveTextValue({
        value: 'secret',
        parent: script,
        needsMask: true,
        maskTextFn: undefined,
        exemptScript: false,
      }),
    ).toBe('******');
  });
});

describe('needMaskingText accepts the legacy selector string', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const target = (html: string): Node => {
    document.body.innerHTML = html;
    return document.querySelector('#t')!;
  };

  it('masks through a raw selector string, as the split pair does', () => {
    const node = target('<div class="secret"><span id="t">x</span></div>');
    expect(needMaskingText(node, 'rr-mask', '.secret', null, true)).toBe(true);
    expect(
      needMaskingText(
        node,
        'rr-mask',
        splitMaskAllSelector('.secret'),
        null,
        true,
      ),
    ).toBe(true);
  });

  it("honors a raw '*' mask-everything string", () => {
    const node = target('<div><span id="t">x</span></div>');
    expect(needMaskingText(node, 'rr-mask', '*', null, true)).toBe(true);
  });

  it("still splits '*' out of a raw list so an unmask ancestor can win", () => {
    const node = target('<div class="ok"><span id="t">x</span></div>');
    expect(needMaskingText(node, 'rr-mask', '*', '.ok', true)).toBe(false);
  });

  it('treats a null/undefined selector as "none configured", not as a throw', () => {
    const node = target('<div><span id="t">x</span></div>');
    expect(needMaskingText(node, 'rr-mask', null, null, true)).toBe(false);
    expect(
      needMaskingText(
        node,
        'rr-mask',
        undefined as unknown as null,
        null,
        true,
      ),
    ).toBe(false);
  });
});

/**
 * The pre-2.0 signature was
 * `(node, maskTextClass, maskTextSelector, checkAncestors)`. Adding
 * `unmaskTextSelector` in the fourth slot shifted an unmigrated caller's
 * boolean into it and left `checkAncestors` `undefined` -- which fails
 * *open*: the ancestor walk stops at the node, so a `.rr-mask` ancestor no
 * longer masks. The boolean is shape-detected and shifted back instead.
 */
describe('needMaskingText accepts the legacy 4-arg positional call', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const target = (html: string): Node => {
    document.body.innerHTML = html;
    return document.querySelector('#t')!;
  };

  const legacy = (
    node: Node,
    checkAncestors: boolean,
    maskTextSelector: string | null = null,
  ): boolean =>
    needMaskingText(
      node,
      'rr-mask',
      maskTextSelector,
      checkAncestors as unknown as null,
    );

  it('still masks under a .rr-mask ancestor with checkAncestors true', () => {
    const node = target('<div class="rr-mask"><span id="t">x</span></div>');
    expect(legacy(node, true)).toBe(true);
  });

  it('does not walk to that ancestor when the legacy call passed false', () => {
    const node = target('<div class="rr-mask"><span id="t">x</span></div>');
    expect(legacy(node, false)).toBe(false);
  });

  it('still matches on the node itself with checkAncestors false', () => {
    const node = target('<div><span id="t" class="rr-mask">x</span></div>');
    expect(legacy(node, false)).toBe(true);
  });

  it('honors a legacy selector string alongside the shifted boolean', () => {
    const node = target('<div class="secret"><span id="t">x</span></div>');
    expect(legacy(node, true, '.secret')).toBe(true);
    expect(legacy(node, false, '.secret')).toBe(false);
  });

  it('never reads the shifted boolean as an unmask selector', () => {
    // '*' masks everything; a legacy caller supplies no unmask escape, so the
    // shifted `true` must not open one.
    const node = target('<div><span id="t">x</span></div>');
    expect(legacy(node, true, '*')).toBe(true);
  });

  it('leaves the new signature untouched', () => {
    const node = target('<div class="rr-mask"><span id="t">x</span></div>');
    expect(needMaskingText(node, 'rr-mask', null, null, true)).toBe(true);
    expect(needMaskingText(node, 'rr-mask', null, null, false)).toBe(false);
    // an unmask ancestor still wins over the class when the walk is on
    const unmasked = target(
      '<div class="rr-mask"><span class="ok"><b id="t">x</b></span></div>',
    );
    expect(needMaskingText(unmasked, 'rr-mask', null, '.ok', true)).toBe(false);
  });
});

/**
 * `needMaskingText`'s catch-all fails closed to masking (see the
 * `merge helpers validate the record()-level selector` note above for why an
 * ancestor `matches()` can throw at all). The one-time warning tells an
 * embedder their custom selector is broken instead of silently masking
 * forever with no signal.
 */
describe('needMaskingText warns once when the mask decision throws', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('fails closed to masking and warns exactly once across repeated throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    document.body.innerHTML = '<div><span id="t">x</span></div>';
    const node = document.querySelector('#t')!;
    expect(needMaskingText(node, 'rr-mask', ':::garbage', null, true)).toBe(
      true,
    );
    expect(needMaskingText(node, 'rr-mask', ':::garbage', null, true)).toBe(
      true,
    );
    const throwWarnings = warn.mock.calls.filter(([msg]) =>
      String(msg).includes('privacy mask decision threw'),
    );
    expect(throwWarnings).toHaveLength(1);
    expect(throwWarnings[0][0]).toContain('failing closed to masking');
  });
});
