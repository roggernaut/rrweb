/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  compilePrivacyPolicy,
  validateSelector,
  mergeSelectors,
  resolvePrivacyContext,
  splitSelectorList,
  resolveTextValue,
} from '../src/privacy';
import snapshot, {
  needMaskingText,
  splitMaskAllSelector,
} from '../src/snapshot';

describe('compilePrivacyPolicy v2', () => {
  it('manual preset compiles to inert options', () => {
    const c = compilePrivacyPolicy(undefined);
    expect(c.preset).toBe('manual');
    expect(c.maskTextSelector).toBeNull();
    expect(c.blockSelector).toBeNull();
    expect(c.maskAllInputs).toBe(false);
    expect([...c.maskedAttributes]).toEqual([]);
    expect(c.attributePolicyInert).toBe(true);
  });
  it('balanced masks inputs and attributes but not text', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
    expect(c.maskAllInputs).toBe(true);
    expect([...c.maskedAttributes]).toEqual([
      'title',
      'placeholder',
      'aria-label',
    ]);
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
      compilePrivacyPolicy({ version: 2 as never, preset: 'manual' }),
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

  it('activates under manual only alongside a mask rule, as before', () => {
    const bare = compilePrivacyPolicy({ version: 1, preset: 'manual' });
    expect(bare.maskTextSelector).toBeNull();
    const withRule = compilePrivacyPolicy({
      version: 1,
      preset: 'manual',
      rules: [{ target: { type: 'selector', selector: '.x' }, action: 'mask' }],
    });
    document.body.innerHTML = '<div id="t" data-privacy="typo"></div>';
    expect(
      (document.querySelector('#t') as HTMLElement).matches(
        withRule.maskTextSelector as string,
      ),
    ).toBe(true);
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

  it('stays inert under manual, which never merged vendor classes', () => {
    const c = compilePrivacyPolicy({
      version: 1,
      preset: 'manual',
      vendorCompat: true,
    });
    expect(c.maskTextSelector).toBeNull();
    expect(c.blockSelector).toBeNull();
  });
});

describe('validateSelector', () => {
  it('accepts valid, rejects invalid', () => {
    expect(validateSelector('.a > [data-x="1"]')).toBe(true);
    expect(validateSelector(':::nope')).toBe(false);
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

  it('keeps the valid half of a partly-malformed manual selector', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // ':::garbage,.valid' is a single invalid selector string, so it is
    // dropped whole; the caller keeps the compiled policy's own selectors.
    const merged = mergeSelectors(
      ':::garbage,.valid',
      balanced.maskTextSelector,
    );
    expect(merged).toBe(balanced.maskTextSelector);
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
    const manual = compilePrivacyPolicy(undefined);
    const merged = mergeSelectors('.a\\,b,b', manual.maskTextSelector)!;

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
      preset: 'manual',
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
      '<p>keep this text</p><p class="valid">also kept</p>';

    const out = JSON.stringify(
      snapshot(document, {
        privacyPolicy: { version: 1, preset: 'balanced' },
        maskTextSelector: mergeSelectors(
          ':::garbage,.valid',
          balanced.maskTextSelector,
        ),
      }),
    );

    expect(out).toContain('keep this text');
    expect(out).not.toContain('****');
    expect(warn).toHaveBeenCalled();
  });
});
/**
 * `needMaskingText` is exported from the package root and its third parameter
 * changed shape (raw selector string -> pre-split `{maskAll, selector}`). An
 * un-updated or untyped caller still passing the string used to destructure to
 * `{maskAll: undefined, selector: undefined}`, at which point every mask
 * selector silently stopped matching -- a fail-open on the masking path, which
 * is the one direction that must never happen quietly.
 */
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
