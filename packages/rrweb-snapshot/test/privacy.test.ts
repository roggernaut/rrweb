/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import snapshot from '../src/snapshot';
import {
  compilePrivacyPolicy,
  detectSensitiveText,
  getPrivacyAction,
  maskInputWithPrivacy,
  maskTextWithPrivacy,
  passesLuhn,
  sanitizeUrl,
} from '../src/privacy';

const balanced = () =>
  compilePrivacyPolicy({ version: 1, preset: 'balanced' })!;

describe('privacy policy', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('detects cards with Luhn instead of masking every long number', () => {
    const privacy = balanced();
    const value = 'valid 4111 1111 1111 1111 invalid 4111 1111 1111 1112';
    const matches = detectSensitiveText(value, privacy);

    expect(passesLuhn('4111 1111 1111 1111')).toBe(true);
    expect(passesLuhn('4111 1111 1111 1112')).toBe(false);
    expect(
      matches.filter((match) => match.detector === 'payment-card'),
    ).toEqual([
      expect.objectContaining({
        start: value.indexOf('4111 1111 1111 1111'),
        end: value.indexOf('4111 1111 1111 1111') + 19,
      }),
    ]);
  });

  it('masks only detected ranges in balanced text', () => {
    const element = document.createElement('p');
    expect(
      maskTextWithPrivacy(
        'Contact person@example.com about order 12345',
        element,
        balanced(),
        false,
      ),
    ).toBe('Contact xxxxxx@xxxxxxx.xxx about order 12345');
  });

  it('runs configured detectors in custom policies', () => {
    const element = document.createElement('p');
    const privacy = compilePrivacyPolicy({
      version: 1,
      preset: 'custom',
      detectors: {
        custom: [{ name: 'account-id', pattern: 'acct_[0-9]+' }],
      },
    });

    expect(
      maskTextWithPrivacy(
        'Account acct_12345 is active',
        element,
        privacy,
        false,
      ),
    ).toBe('Account xxxx_00000 is active');
  });

  it('rejects unsafe or unbounded custom detector configurations', () => {
    const policyWith = (pattern: string, flags?: string) => () =>
      compilePrivacyPolicy({
        version: 1,
        preset: 'custom',
        detectors: {
          custom: [{ name: 'unsafe', pattern, flags }],
        },
      });

    expect(policyWith('(a+)+$')).toThrow('ambiguous nested repetition');
    expect(policyWith('(a|aa)+$')).toThrow('ambiguous nested repetition');
    expect(policyWith('(a)\\1')).toThrow('backreferences');
    expect(policyWith('a*')).toThrow('cannot match empty text');
    expect(policyWith('account', 'y')).toThrow('unsupported regex flags');
    expect(policyWith('a'.repeat(257))).toThrow('must be 1-256 characters');
    expect(() =>
      compilePrivacyPolicy({
        version: 1,
        preset: 'custom',
        detectors: {
          custom: [
            {
              name: 'too-wide',
              pattern: 'account_[0-9]+',
              maximumMatchLength: 1_025,
            },
          ],
        },
      }),
    ).toThrow('maximumMatchLength');
  });

  it('uses detector length fast paths and finds matches across scan chunks', () => {
    const custom = compilePrivacyPolicy({
      version: 1,
      preset: 'custom',
      detectors: {
        custom: [
          {
            name: 'account-id',
            pattern: 'acct_[0-9]+',
            minimumLength: 12,
            maximumMatchLength: 32,
          },
        ],
      },
    });
    expect(detectSensitiveText('acct_1', custom)).toEqual([]);
    const customBoundaryValue = `${'x'.repeat(508)}acct_12345`;
    expect(detectSensitiveText(customBoundaryValue, custom)).toEqual([
      expect.objectContaining({ start: 508, end: customBoundaryValue.length }),
    ]);

    const value = `${'x'.repeat(8_187)}4111 1111 1111 1111`;
    expect(
      detectSensitiveText(value, balanced()).some(
        (match) => match.detector === 'payment-card' && match.start === 8_187,
      ),
    ).toBe(true);
  });

  it('fails closed when a value produces too many detector matches', () => {
    const privacy = compilePrivacyPolicy({
      version: 1,
      preset: 'custom',
      detectors: {
        custom: [
          {
            name: 'digit',
            pattern: '[0-9]',
            maximumMatchLength: 1,
          },
        ],
      },
    });
    const value = '1'.repeat(1_500);
    expect(detectSensitiveText(value, privacy)).toEqual([
      expect.objectContaining({ start: 0, end: value.length }),
    ]);

    const oversize = compilePrivacyPolicy({
      version: 1,
      preset: 'custom',
      detectors: {
        custom: [
          {
            name: 'bounded-digits',
            pattern: '[0-9]+',
            maximumMatchLength: 4,
          },
        ],
      },
    });
    const oversizeValue = 'public 12345 trailing text';
    expect(detectSensitiveText(oversizeValue, oversize)).toEqual([
      expect.objectContaining({ start: 0, end: oversizeValue.length }),
    ]);
  });

  it('skips non-content text and replaces incremental script text', () => {
    const style = document.createElement('style');
    const script = document.createElement('script');
    expect(
      maskTextWithPrivacy(
        '.person@example.com { color: red }',
        style,
        balanced(),
        false,
      ),
    ).toBe('.person@example.com { color: red }');
    expect(
      maskTextWithPrivacy(
        'window.secret = "person@example.com"',
        script,
        balanced(),
        false,
      ),
    ).toBe('SCRIPT_PLACEHOLDER');
  });

  it('uses nearest explicit rules and safer action for ties', () => {
    document.body.innerHTML = `
      <main class="allow mask">
        <section class="allow"><span id="target">secret</span></section>
      </main>`;
    const target = document.querySelector('#target')!;
    const privacy = compilePrivacyPolicy({
      version: 1,
      preset: 'custom',
      rules: [
        {
          target: { type: 'selector', selector: '.allow' },
          action: 'allow',
        },
        {
          target: { type: 'selector', selector: '.mask' },
          action: 'mask',
        },
      ],
    });

    expect(getPrivacyAction(target, privacy)).toBe('allow');
    expect(
      getPrivacyAction(
        document.querySelector('main'),
        compilePrivacyPolicy({
          version: 1,
          preset: 'custom',
          rules: [
            {
              target: { type: 'selector', selector: '.allow' },
              action: 'allow',
            },
            {
              target: { type: 'selector', selector: '.mask' },
              action: 'mask',
            },
          ],
        }),
      ),
    ).toBe('mask');
  });

  it('recognizes data-privacy without recorder configuration', () => {
    document.body.innerHTML = `
      <section data-privacy="mask" title="Private title">
        <p>Private customer <span data-privacy="allow">Public label</span></p>
        <input type="text" value="Private input" />
        <input data-privacy="allow" type="password" value="secret-password" />
      </section>
      <section data-privacy="exclude">Excluded account 12345</section>`;

    const payload = JSON.stringify(snapshot(document));

    expect(payload).not.toContain('Private title');
    expect(payload).not.toContain('Private customer');
    expect(payload).not.toContain('Private input');
    expect(payload).not.toContain('secret-password');
    expect(payload).not.toContain('Excluded account 12345');
    expect(payload).toContain('Public label');
  });

  it('inherits past invalid data-privacy values and resolves ties safely', () => {
    document.body.innerHTML = `
      <main data-privacy="mask">
        <span id="invalid" data-privacy="unknown">Private</span>
        <span id="tie" data-privacy="allow" class="policy-mask">Private</span>
      </main>`;
    const privacy = compilePrivacyPolicy({
      version: 1,
      preset: 'custom',
      rules: [
        {
          target: { type: 'selector', selector: '.policy-mask' },
          action: 'mask',
        },
      ],
    });

    expect(getPrivacyAction(document.querySelector('#invalid'), privacy)).toBe(
      'mask',
    );
    expect(getPrivacyAction(document.querySelector('#tie'), privacy)).toBe(
      'mask',
    );
  });

  it('maps exclude policy rules to rrweb blocking', () => {
    document.body.innerHTML =
      '<section class="private">Excluded by policy</section>';
    const privacyPolicy = {
      version: 1 as const,
      preset: 'custom' as const,
      rules: [
        {
          target: { type: 'selector' as const, selector: '.private' },
          action: 'exclude' as const,
        },
      ],
    };
    const privacy = compilePrivacyPolicy(privacyPolicy);
    const payload = JSON.stringify(snapshot(document, { privacyPolicy }));

    expect(privacy.blockSelector).toContain('.private');
    expect(payload).not.toContain('Excluded by policy');
  });

  it('preserves structural attributes unless they are explicitly targeted', () => {
    document.body.innerHTML = `
      <input class="private layout" type="text" data-secret="account-123" value="Private value" />`;
    const payload = JSON.stringify(
      snapshot(document, {
        privacyPolicy: {
          version: 1,
          preset: 'custom',
          rules: [
            {
              target: { type: 'selector', selector: '.private' },
              action: 'mask',
            },
            {
              target: {
                type: 'selector',
                selector: '.private',
                attributes: ['data-secret'],
              },
              action: 'mask',
            },
          ],
        },
      }),
    );

    expect(payload).toContain('private layout');
    expect(payload).toContain('"type":"text"');
    expect(payload).not.toContain('account-123');
    expect(payload).not.toContain('Private value');
  });

  it('does not allow protected inputs to be unmasked', () => {
    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'record';
    const privacy = compilePrivacyPolicy({
      version: 1,
      preset: 'custom',
      rules: [
        {
          target: { type: 'selector', selector: '.record' },
          action: 'allow',
        },
      ],
    });

    expect(
      maskInputWithPrivacy('secret', input, privacy, false, () => 'secret'),
    ).toBe('xxxxxx');

    input.type = 'text';
    input.setAttribute('data-rr-is-password', 'true');
    expect(
      maskInputWithPrivacy('visible', input, privacy, false, () => 'visible'),
    ).toBe('xxxxxxx');

    input.type = 'password';
    input.removeAttribute('data-rr-is-password');
    input.setAttribute('data-privacy', 'allow');
    expect(
      maskInputWithPrivacy(
        'protected',
        input,
        compilePrivacyPolicy(undefined),
        false,
        () => 'protected',
      ),
    ).toBe('xxxxxxxxx');
  });

  it('removes sensitive URL values while retaining routing context', () => {
    expect(
      sanitizeUrl(
        'https://example.com/account?tab=billing&token=secret#profile',
        balanced(),
      ),
    ).toBe('https://example.com/account?tab=billing&token=*');

    expect(
      sanitizeUrl(
        'https://example.com/account?tab=billing',
        compilePrivacyPolicy({ version: 1, preset: 'strict' }),
      ),
    ).toBe('https://example.com/account?tab=*');
  });

  it('inherits rules across a shadow-root boundary', () => {
    const host = document.createElement('div');
    host.className = 'private';
    const shadow = host.attachShadow({ mode: 'open' });
    const child = document.createElement('span');
    shadow.appendChild(child);
    document.body.appendChild(host);

    expect(
      getPrivacyAction(
        child,
        compilePrivacyPolicy({
          version: 1,
          preset: 'custom',
          rules: [
            {
              target: { type: 'selector', selector: '.private' },
              action: 'mask',
            },
          ],
        }),
      ),
    ).toBe('mask');
  });

  it('applies policy before a snapshot is serialized', () => {
    document.body.innerHTML = `
      <p title="person@example.com">Contact person@example.com</p>
      <input type="text" value="private input" />
      <input type="password" class="record" value="secret-password" />
      <a href="https://example.com/?token=secret">Account</a>`;

    const serialized = snapshot(document, {
      privacyPolicy: {
        version: 1,
        preset: 'balanced',
        rules: [
          {
            target: { type: 'selector', selector: '.record' },
            action: 'allow',
          },
        ],
      },
    });
    const payload = JSON.stringify(serialized);

    expect(payload).not.toContain('person@example.com');
    expect(payload).not.toContain('private input');
    expect(payload).not.toContain('secret-password');
    expect(payload).not.toContain('token=secret');
    expect(payload).toContain('Contact xxxxxx@xxxxxxx.xxx');
    expect(payload).toContain('token=*');
  });

  it('masks every form value attribute in strict mode', () => {
    document.body.innerHTML = `
      <input type="radio" value="private-radio-value" />
      <select><option value="private-option-value">Private option</option></select>`;
    const payload = JSON.stringify(
      snapshot(document, {
        privacyPolicy: { version: 1, preset: 'strict' },
      }),
    );

    expect(payload).not.toContain('private-radio-value');
    expect(payload).not.toContain('private-option-value');
    expect(payload).not.toContain('Private option');
  });

  it('supports coarse masking of final source attributes', () => {
    document.body.innerHTML = `
      <div class="customer-name" style="--owner: person@example.com" title="person@example.com"></div>
      <input value="private synthesized value" />`;
    const payload = JSON.stringify(
      snapshot(document, { maskAllElementAttributes: true }),
    );

    expect(payload).not.toContain('customer-name');
    expect(payload).not.toContain('person@example.com');
    expect(payload).not.toContain('private synthesized value');
  });

  it('lets a callback mask final attributes but never override policy', () => {
    document.body.innerHTML = `
      <div data-owner="person@example.com" title="person@example.com"></div>`;
    const payload = JSON.stringify(
      snapshot(document, {
        privacyPolicy: { version: 1, preset: 'balanced' },
        maskAttributeFn: (name, value) =>
          name === 'data-owner' ? '[OWNER]' : value,
      }),
    );

    expect(payload).toContain('[OWNER]');
    expect(payload).not.toContain('person@example.com');
    expect(payload).toContain('xxxxxx@xxxxxxx.xxx');
  });

  it('fails closed when an attribute callback throws', () => {
    document.body.innerHTML = '<div title="private-title"></div>';
    const payload = JSON.stringify(
      snapshot(document, {
        maskAttributeFn: () => {
          throw new Error('boom');
        },
      }),
    );

    expect(payload).not.toContain('private-title');
  });

  it('suppresses full-snapshot canvas pixels while region masking is configured', () => {
    const canvas = document.createElement('canvas');
    (canvas as HTMLCanvasElement & { __context?: string }).__context = '2d';
    canvas.getContext = (() => ({
      getImageData: () => ({ data: new Uint8ClampedArray([255, 0, 0, 255]) }),
    })) as unknown as typeof canvas.getContext;
    canvas.toDataURL = () => 'data:image/webp;base64,unmasked-pixels';
    document.body.appendChild(canvas);

    const unprotected = JSON.stringify(
      snapshot(document, {
        recordCanvas: true,
        canvasMaskingConfigured: () => false,
      }),
    );
    const protectedSnapshot = JSON.stringify(
      snapshot(document, {
        recordCanvas: true,
        canvasMaskingConfigured: () => true,
      }),
    );

    expect(unprotected).toContain('rr_dataURL');
    expect(protectedSnapshot).not.toContain('rr_dataURL');
  });

  it('keeps the legacy path unchanged when no policy is supplied', () => {
    document.body.innerHTML =
      '<p>Visible text</p><input type="hidden" value="legacy-hidden-value">';
    const payload = JSON.stringify(snapshot(document));
    expect(payload).toContain('Visible text');
    expect(payload).toContain('legacy-hidden-value');
    expect(
      maskInputWithPrivacy(
        'legacy value',
        document.createElement('input'),
        undefined,
        true,
      ),
    ).toBe('************');
  });
});
