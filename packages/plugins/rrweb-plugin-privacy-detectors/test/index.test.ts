import { describe, expect, it } from 'vitest';
import {
  applyPrivacyDetectors,
  getRecordPrivacyDetectorsPlugin,
  PLUGIN_NAME,
} from '../src/index';
import {
  compilePrivacyPolicy,
  detectSensitiveValue,
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
      preset: 'legacy',
      detectors: {
        email: true,
        phone: true,
        paymentCard: true,
        ssn: true,
        ipAddress: true,
      },
    });
  });

  it('plugin with no user policy yields a legacy policy whose compiled detectors are active', () => {
    const plugin = getRecordPrivacyDetectorsPlugin();
    const policy = plugin.applyPrivacyPolicy!(undefined) as PrivacyPolicy;
    expect(policy.preset).toBe('legacy');
    const compiled = compilePrivacyPolicy(policy);
    expect(compiled.detectors.length).toBeGreaterThan(0);
    expect(detectSensitiveValue('bob@example.com', compiled)).toBe(true);
  });
});
