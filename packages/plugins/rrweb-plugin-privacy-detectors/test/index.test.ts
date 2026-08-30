/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
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
      preset: 'minimal',
      detectors: {
        email: true,
        phone: true,
        paymentCard: true,
        ssn: true,
        ipAddress: true,
      },
    });
  });

  it('plugin with no user policy yields a minimal policy whose compiled detectors are active', () => {
    const plugin = getRecordPrivacyDetectorsPlugin();
    const policy = plugin.applyPrivacyPolicy!(undefined) as PrivacyPolicy;
    expect(policy.preset).toBe('minimal');
    const compiled = compilePrivacyPolicy(policy);
    expect(compiled.detectors.length).toBeGreaterThan(0);
    expect(detectSensitiveValue('bob@example.com', compiled)).toBe(true);
  });

  it.each(['minimal', 'balanced', 'strict'] as const)(
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
      preset: 'minimal',
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

/**
 * The module-level once-flag means this only reads cleanly against a fresh
 * module instance -- `vi.resetModules()` plus a dynamic re-import isolates
 * it from every other test in this file that already exercised
 * `applyPrivacyPolicy`.
 */
describe('privacy-detectors active info log', () => {
  it('logs once at first policy application, across plugin instances', async () => {
    vi.resetModules();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const fresh = await import('../src/index');
      const plugin = fresh.getRecordPrivacyDetectorsPlugin();
      plugin.applyPrivacyPolicy?.({ version: 1, preset: 'minimal' });
      plugin.applyPrivacyPolicy?.({ version: 1, preset: 'minimal' });
      const secondPlugin = fresh.getRecordPrivacyDetectorsPlugin();
      secondPlugin.applyPrivacyPolicy?.({ version: 1, preset: 'minimal' });

      const activeLogs = info.mock.calls.filter(([msg]) =>
        String(msg).includes('privacy-detectors active'),
      );
      expect(activeLogs).toHaveLength(1);
      expect(activeLogs[0][0]).toContain(
        'input values record as length-only stars',
      );
    } finally {
      info.mockRestore();
      vi.resetModules();
    }
  });
});
