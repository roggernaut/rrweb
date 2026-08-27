/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import snapshot from '../src/snapshot';
import { compilePrivacyPolicy } from '../src/privacy';

/**
 * Guards the "legacy is sacred" performance contract: a recorder that never
 * opted into the v2 privacy policy must pay zero cost for it. If any of
 * these selectors show up in an `Element.prototype.matches` call during a
 * legacy snapshot, `compilePrivacyPolicy`/`mergeBlockSelectors`/
 * `needMaskingText` have started doing privacy-selector work even when the
 * caller never asked for it.
 */
const PRIVACY_SELECTOR_FRAGMENTS = [
  'data-privacy',
  'rr-mask',
  'rr-unmask',
  'rr-block',
  'mp-mask',
  'mp-block',
  'fs-mask',
  'fs-exclude',
  'amp-mask',
  'amp-unmask',
  'amp-block',
  'ph-mask',
  'ph-no-capture',
  'sentry-mask',
  'sentry-block',
  'data-sentry-mask',
  'dd-privacy',
  'nr-mask',
  'nr-block',
];

function buildDeepDom() {
  document.body.innerHTML =
    '<div>'.repeat(200) + 'deep text' + '</div>'.repeat(200);
}

function privacyAttributableCalls(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter(
    ([sel]) =>
      typeof sel === 'string' &&
      PRIVACY_SELECTOR_FRAGMENTS.some((fragment) => sel.includes(fragment)),
  );
}

describe('privacy v2 perf smoke', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('legacy snapshot performs no privacy selector matching', () => {
    // Sanity-check the compiled shape a caller gets when it never opts into
    // v2 privacy: every selector is null/empty, so nothing should ever
    // reach `.matches()` with a privacy-attributable selector.
    const compiled = compilePrivacyPolicy(undefined);
    expect(compiled.preset).toBe('legacy');
    expect(compiled.maskTextSelector).toBeNull();
    expect(compiled.blockSelector).toBeNull();

    const spy = vi.spyOn(Element.prototype, 'matches');
    buildDeepDom();

    // No `privacyPolicy` passed in the options object at all -- this is the
    // shape every pre-v2 caller uses.
    snapshot(document, {});

    const privacyCalls = privacyAttributableCalls(spy);
    expect(privacyCalls).toEqual([]);
    spy.mockRestore();
  });

  it('snapshot with no privacy argument at all behaves identically (legacy sacred)', () => {
    const spy = vi.spyOn(Element.prototype, 'matches');
    buildDeepDom();

    snapshot(document);

    const privacyCalls = privacyAttributableCalls(spy);
    expect(privacyCalls).toEqual([]);
    spy.mockRestore();
  });
});
