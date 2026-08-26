/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { compilePrivacyPolicy, validateSelector, mergeBlockSelectors } from '../src/privacy';

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
