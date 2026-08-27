/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  compilePrivacyPolicy,
  validateSelector,
  mergeBlockSelectors,
  mergeMaskTextSelectors,
  mergeUnmaskTextSelectors,
  detectSensitiveValue,
  buildDetectors,
  sanitizeUrl,
  splitSelectorList,
} from '../src/privacy';
import snapshot from '../src/snapshot';

describe('compilePrivacyPolicy v2', () => {
  it('legacy preset compiles to inert options', () => {
    const c = compilePrivacyPolicy(undefined);
    expect(c.preset).toBe('legacy');
    expect(c.maskTextSelector).toBeNull();
    expect(c.blockSelector).toBeNull();
    expect(c.maskAllInputs).toBe(false);
    expect(c.maskedAttributes).toEqual([]);
    expect(c.sanitizeUrls).toBe(false);
    expect(c.detectors).toEqual([]);
  });
  it('balanced masks inputs, attributes and URLs but not text', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
    expect(c.maskAllInputs).toBe(true);
    expect(c.maskedAttributes).toEqual(['title', 'placeholder', 'aria-label']);
    expect(c.sanitizeUrls).toBe(true);
    expect(c.maskTextSelector).not.toContain('*');
    expect(c.maskTextSelector).toContain('[data-privacy="mask"]');
    expect(c.maskTextSelector).toContain('.ph-mask'); // cross-vendor classes
    expect(c.maskTextSelector).toContain('.dd-privacy-mask'); // Datadog
    expect(c.maskTextSelector).toContain('[data-nr-mask]'); // New Relic
    expect(c.blockSelector).toContain('[data-privacy="exclude"]');
    expect(c.blockSelector).toContain('.dd-privacy-hidden'); // Datadog
    expect(c.blockSelector).toContain('[data-nr-block]'); // New Relic
  });
  it('strict masks all text and blocks media', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'strict' });
    expect(c.maskTextSelector).toBe('*');
    expect(c.blockMedia).toBe(true);
  });
  it('compiles rules into selector lists, unmask as alias of allow', () => {
    const c = compilePrivacyPolicy({
      version: 1,
      preset: 'balanced',
      rules: [
        { target: { type: 'selector', selector: '.pii' }, action: 'mask' },
        { target: { type: 'selector', selector: '.safe' }, action: 'unmask' },
        { target: { type: 'selector', selector: '.gone' }, action: 'exclude' },
      ],
    });
    expect(c.maskTextSelector).toContain('.pii');
    expect(c.unmaskTextSelector).toContain('.safe');
    expect(c.blockSelector).toContain('.gone');
  });
  it('recognizes only real vendor unmask tokens plus rrweb’s own', () => {
    // Amplitude is the only vendor shipping an unmask class. Sentry's
    // `unmask` default is `[]` -- there is no `.sentry-unmask` convention to
    // be compatible with, so claiming one would be fiction.
    const c = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
    expect(c.unmaskTextSelector).toContain('.rr-unmask');
    expect(c.unmaskTextSelector).toContain('.amp-unmask');
    expect(c.unmaskTextSelector).not.toContain('sentry-unmask');
    // the mask/block lists stay full cross-vendor compat
    expect(c.maskTextSelector).toContain('.sentry-mask');
    expect(c.blockSelector).toContain('.sentry-block');
  });
  it('drops invalid selectors individually with a warning, keeps the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = compilePrivacyPolicy({
      version: 1,
      preset: 'balanced',
      rules: [
        {
          target: { type: 'selector', selector: ':::garbage' },
          action: 'exclude',
        },
        { target: { type: 'selector', selector: '.valid' }, action: 'exclude' },
      ],
    });
    expect(c.blockSelector).toContain('.valid');
    expect(c.blockSelector).not.toContain(':::garbage');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(':::garbage'));
    warn.mockRestore();
  });
  it('throws on bad version/preset/empty selector', () => {
    expect(() =>
      compilePrivacyPolicy({ version: 2 as never, preset: 'legacy' }),
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
    // `.a\,b` is a single class selector for the class name "a,b" -- the
    // backslash escape is valid outside quotes too, and tearing it here let
    // the stray `b` fragment collide with an unrelated `b` selector.
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

describe('mergeBlockSelectors', () => {
  it('joins legacy selector with compiled blockSelector', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
    expect(mergeBlockSelectors('.legacy', c)).toContain('.legacy');
    expect(mergeBlockSelectors('.legacy', c)).toContain(
      '[data-privacy="exclude"]',
    );
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
    ['mergeMaskTextSelectors', mergeMaskTextSelectors],
    ['mergeUnmaskTextSelectors', mergeUnmaskTextSelectors],
    ['mergeBlockSelectors', mergeBlockSelectors],
  ])('%s drops an invalid legacy half with a warning', (_name, merge) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const merged = merge(':::garbage', balanced);
    expect(merged).not.toContain(':::garbage');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('dropping invalid selector'),
    );
  });

  it('keeps the valid half of a partly-malformed legacy selector', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // ':::garbage,.valid' is a single invalid selector string, so it is
    // dropped whole; the caller keeps the compiled policy's own selectors.
    const merged = mergeMaskTextSelectors(':::garbage,.valid', balanced);
    expect(merged).toBe(balanced.maskTextSelector);
    expect(warn).toHaveBeenCalled();
  });

  /**
   * `record()` merges the policy's selectors into the options it hands to
   * `snapshot()`, which compiles the same policy and merges a second time.
   * Without deduplication every fragment would be repeated on each pass.
   */
  it('is idempotent: re-merging an already-merged selector adds nothing', () => {
    const once = mergeUnmaskTextSelectors(null, balanced);
    const twice = mergeUnmaskTextSelectors(once, balanced);
    expect(twice).toBe(once);
    expect(mergeUnmaskTextSelectors(twice, balanced)).toBe(once);
  });

  it('deduplicates a fragment the legacy half repeats from the policy', () => {
    const merged = mergeMaskTextSelectors('.rr-mask,.mine', balanced);
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
    const legacy = compilePrivacyPolicy(undefined);
    const merged = mergeMaskTextSelectors('.a\\,b,b', legacy)!;

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
      preset: 'legacy',
      rules: [{ target: { type: 'selector', selector: 'b' }, action: 'mask' }],
    });
    const merged = mergeMaskTextSelectors('.a\\,b', policy)!;

    document.body.innerHTML = '<div class="a,b">x</div><b>y</b>';
    expect(document.querySelector('div')!.matches(merged)).toBe(true);
    expect(document.querySelector('b')!.matches(merged)).toBe(true);
  });

  it('does not tear a selector whose commas are nested', () => {
    // a naive split(',') would produce ':is(.a' and '.b)' -- rejoining
    // deduplicated halves of those would corrupt the selector
    const merged = mergeMaskTextSelectors(
      ':is(.a,.b),[data-x="p,q"]',
      balanced,
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
        maskTextSelector: mergeMaskTextSelectors(':::garbage,.valid', balanced),
      }),
    );

    expect(out).toContain('keep this text');
    expect(out).not.toContain('****');
    expect(warn).toHaveBeenCalled();
  });
});

describe('detectSensitiveValue', () => {
  const withDetectors = compilePrivacyPolicy({
    version: 1,
    preset: 'legacy',
    detectors: {
      email: true,
      phone: true,
      paymentCard: true,
      ssn: true,
      ipAddress: true,
    },
  });

  it('detects a Luhn-valid card adjacent to other digits (review regression)', () => {
    expect(
      detectSensitiveValue(
        'call 5551234567 4111 1111 1111 1111 now',
        withDetectors,
      ),
    ).toBe(true);
  });

  it('detects email, ssn, ip; passes clean prose', () => {
    expect(detectSensitiveValue('contact bob@example.com', withDetectors)).toBe(
      true,
    );
    expect(detectSensitiveValue('ssn 123-45-6789', withDetectors)).toBe(true);
    expect(detectSensitiveValue('host 192.168.0.1', withDetectors)).toBe(true);
    expect(detectSensitiveValue('the quick brown fox', withDetectors)).toBe(
      false,
    );
  });

  it('rejects UUIDs and version strings as cards/ssns (false-positive guard)', () => {
    expect(
      detectSensitiveValue(
        'id 550e8400-e29b-41d4-a716-446655440000',
        withDetectors,
      ),
    ).toBe(false);
    expect(detectSensitiveValue('v1.2.3.4000 build', withDetectors)).toBe(
      false,
    );
  });

  it('detects regardless of preset (works under legacy)', () => {
    expect(withDetectors.preset).toBe('legacy');
    expect(detectSensitiveValue('4111 1111 1111 1111', withDetectors)).toBe(
      true,
    );
  });

  it('no detectors configured -> never detects', () => {
    const none = compilePrivacyPolicy({ version: 1, preset: 'strict' });
    expect(detectSensitiveValue('bob@example.com', none)).toBe(false);
  });

  it('fails closed on absurdly long input instead of scanning it', () => {
    const clean = 'a'.repeat(10_001);
    expect(detectSensitiveValue(clean, withDetectors)).toBe(true);
  });

  it('per-detector toggles work', () => {
    const emailOff = buildDetectors({
      email: false,
      phone: false,
      paymentCard: true,
      ssn: false,
      ipAddress: false,
    });
    expect(emailOff.some((d) => d.name === 'email')).toBe(false);
    expect(emailOff.some((d) => d.name === 'payment-card')).toBe(true);
  });

  it('detects spaced phone format (fix regression)', () => {
    expect(detectSensitiveValue('call 555 123 4567 now', withDetectors)).toBe(
      true,
    );
  });

  it('detects dashed phone format (fix regression)', () => {
    expect(detectSensitiveValue('555-123-4567', withDetectors)).toBe(true);
  });

  it('detects parenthesized area code format (fix regression)', () => {
    expect(detectSensitiveValue('(555) 123-4567', withDetectors)).toBe(true);
  });

  it('detects parenthesized area code with country code (fix regression)', () => {
    expect(detectSensitiveValue('+1 (555) 123-4567', withDetectors)).toBe(true);
  });
});

describe('sanitizeUrl v2', () => {
  const strict = compilePrivacyPolicy({ version: 1, preset: 'strict' });
  const balanced = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
  const legacy = compilePrivacyPolicy(undefined);
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
  it('removes hash unless disabled; legacy passes through untouched', () => {
    expect(sanitizeUrl('https://a.com/x#frag', balanced)).toBe(
      'https://a.com/x',
    );
    expect(sanitizeUrl('https://alice:pw@a.com/?token=x#f', legacy)).toBe(
      'https://alice:pw@a.com/?token=x#f',
    );
  });
  it('unparseable value under non-legacy fails closed by dropping the attribute', () => {
    // null, not '': an empty `src`/`href` re-resolves to the document URL at
    // replay and gets requested. Dropping matches the blockMedia semantics.
    expect(sanitizeUrl('http://[broken', balanced)).toBeNull();
  });
  it('empty in, empty out -- never resolved into a path', () => {
    expect(sanitizeUrl('', balanced)).toBe('');
    expect(sanitizeUrl('', strict)).toBe('');
    expect(sanitizeUrl('', legacy)).toBe('');
  });
});
