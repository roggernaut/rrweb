/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { compilePrivacyPolicy, validateSelector, mergeBlockSelectors, detectSensitiveValue, buildDetectors } from '../src/privacy';

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
    expect(c.blockSelector).toContain('[data-privacy="exclude"]');
  });
  it('strict masks all text and blocks media', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'strict' });
    expect(c.maskTextSelector).toBe('*');
    expect(c.blockMedia).toBe(true);
  });
  it('compiles rules into selector lists, unmask as alias of allow', () => {
    const c = compilePrivacyPolicy({
      version: 1, preset: 'balanced',
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
  it('drops invalid selectors individually with a warning, keeps the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = compilePrivacyPolicy({
      version: 1, preset: 'balanced',
      rules: [
        { target: { type: 'selector', selector: ':::garbage' }, action: 'exclude' },
        { target: { type: 'selector', selector: '.valid' }, action: 'exclude' },
      ],
    });
    expect(c.blockSelector).toContain('.valid');
    expect(c.blockSelector).not.toContain(':::garbage');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(':::garbage'));
    warn.mockRestore();
  });
  it('throws on bad version/preset/empty selector', () => {
    expect(() => compilePrivacyPolicy({ version: 2 as never, preset: 'legacy' })).toThrow();
    expect(() => compilePrivacyPolicy({ version: 1, preset: 'custom' as never })).toThrow();
    expect(() =>
      compilePrivacyPolicy({ version: 1, preset: 'balanced',
        rules: [{ target: { type: 'selector', selector: '' }, action: 'mask' }] }),
    ).toThrow();
  });
  it('precomputes lowercased query parameter sets', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'strict',
      url: { blockedQueryParameters: ['SessionID'] } });
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
describe('mergeBlockSelectors', () => {
  it('joins legacy selector with compiled blockSelector', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
    expect(mergeBlockSelectors('.legacy', c)).toContain('.legacy');
    expect(mergeBlockSelectors('.legacy', c)).toContain('[data-privacy="exclude"]');
  });
});

describe('detectSensitiveValue', () => {
  const withDetectors = compilePrivacyPolicy({
    version: 1,
    preset: 'legacy',
    detectors: { email: true, phone: true, paymentCard: true, ssn: true, ipAddress: true },
  });

  it('detects a Luhn-valid card adjacent to other digits (review regression)', () => {
    expect(detectSensitiveValue('call 5551234567 4111 1111 1111 1111 now', withDetectors)).toBe(true);
  });

  it('detects email, ssn, ip; passes clean prose', () => {
    expect(detectSensitiveValue('contact bob@example.com', withDetectors)).toBe(true);
    expect(detectSensitiveValue('ssn 123-45-6789', withDetectors)).toBe(true);
    expect(detectSensitiveValue('host 192.168.0.1', withDetectors)).toBe(true);
    expect(detectSensitiveValue('the quick brown fox', withDetectors)).toBe(false);
  });

  it('rejects UUIDs and version strings as cards/ssns (false-positive guard)', () => {
    expect(detectSensitiveValue('id 550e8400-e29b-41d4-a716-446655440000', withDetectors)).toBe(false);
    expect(detectSensitiveValue('v1.2.3.4000 build', withDetectors)).toBe(false);
  });

  it('detects regardless of preset (works under legacy)', () => {
    expect(withDetectors.preset).toBe('legacy');
    expect(detectSensitiveValue('4111 1111 1111 1111', withDetectors)).toBe(true);
  });

  it('no detectors configured -> never detects', () => {
    const none = compilePrivacyPolicy({ version: 1, preset: 'strict' });
    expect(detectSensitiveValue('bob@example.com', none)).toBe(false);
  });

  it('per-detector toggles work', () => {
    const emailOff = buildDetectors({ email: false, phone: false, paymentCard: true, ssn: false, ipAddress: false });
    expect(emailOff.some((d) => d.name === 'email')).toBe(false);
    expect(emailOff.some((d) => d.name === 'payment-card')).toBe(true);
  });
});
