/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  applyPrivacyDetectors,
  getRecordPrivacyDetectorsPlugin,
  PLUGIN_NAME,
} from '../src/index';
import {
  compilePrivacyPolicy,
  detectSensitiveValue,
  maskInput,
  type PrivacyPolicy,
} from 'rrweb-snapshot';

describe('privacy detectors plugin', () => {
  it('opts heuristic detectors onto a balanced policy', () => {
    const plugin = getRecordPrivacyDetectorsPlugin();
    expect(plugin.name).toBe(PLUGIN_NAME);
    expect(
      plugin.applyPrivacyPolicy?.({
        version: 1,
        preset: 'balanced',
      }),
    ).toMatchObject({
      version: 1,
      preset: 'balanced',
      detectors: {
        email: true,
        phone: true,
        paymentCard: true,
        ssn: true,
        ipAddress: true,
      },
    });
  });

  it('lets policy flags disable a detector the plugin would enable', () => {
    expect(
      applyPrivacyDetectors(
        {
          version: 1,
          preset: 'balanced',
          detectors: { email: false },
        },
        { email: true },
      ).detectors,
    ).toMatchObject({
      email: false,
      phone: true,
    });
  });

  it('does not upgrade an omitted recorder policy to balanced', () => {
    const plugin = getRecordPrivacyDetectorsPlugin();
    expect(plugin.applyPrivacyPolicy?.(undefined)).toMatchObject({
      version: 1,
      preset: 'manual',
      detectors: {
        email: true,
        phone: true,
        paymentCard: true,
        ssn: true,
        ipAddress: true,
      },
    });
  });

  it('plugin with no user policy yields a manual policy whose compiled detectors are active', () => {
    const plugin = getRecordPrivacyDetectorsPlugin();
    const policy = plugin.applyPrivacyPolicy!(undefined) as PrivacyPolicy;
    expect(policy.preset).toBe('manual');
    const compiled = compilePrivacyPolicy(policy);
    expect(compiled.detectors.length).toBeGreaterThan(0);
    expect(detectSensitiveValue('bob@example.com', compiled)).toBe(true);
  });

  it.each(['manual', 'balanced', 'strict'] as const)(
    'forces maskAllInputs on a %s base policy',
    (preset) => {
      const plugin = getRecordPrivacyDetectorsPlugin();
      const policy = plugin.applyPrivacyPolicy!({
        version: 1,
        preset,
      }) as PrivacyPolicy;
      const compiled = compilePrivacyPolicy(policy);
      // Input values are occluded to length, never scanned -- so the posture
      // does not depend on which preset the page configured.
      expect(compiled.maskAllInputs).toBe(true);
      expect(compiled.preset).toBe(preset);
    },
  );

  it('an unmask escape never reopens an input value', () => {
    const plugin = getRecordPrivacyDetectorsPlugin();
    const policy = plugin.applyPrivacyPolicy!({
      version: 1,
      preset: 'manual',
      rules: [
        {
          target: { type: 'selector', selector: '.rr-unmask' },
          action: 'unmask',
        },
      ],
    }) as PrivacyPolicy;
    const compiled = compilePrivacyPolicy(policy);
    expect(compiled.unmaskTextSelector).toContain('.rr-unmask');
    // The unmask selector reopens text and the preset's masked attributes;
    // `maskAllInputs` is consulted with no unmask escape at all.
    expect(compiled.maskAllInputs).toBe(true);
    expect(
      maskInput({
        element: document.createElement('input'),
        tagName: 'input',
        type: 'text',
        value: 'Visible Name',
        maskInputOptions: {},
        privacy: compiled,
      }),
    ).toBe('*'.repeat('Visible Name'.length));
  });
});
