import type { RecordPlugin } from '@rrweb/types';
import {
  applyPrivacyDetectors,
  DEFAULT_PRIVACY_DETECTORS,
  type PrivacyPolicy,
} from 'rrweb-snapshot';

export type PrivacyDetectorsPluginOptions = Partial<
  typeof DEFAULT_PRIVACY_DETECTORS
>;

export const PLUGIN_NAME = 'rrweb/privacy-detectors@1';

export { applyPrivacyDetectors, DEFAULT_PRIVACY_DETECTORS };

/**
 * Heuristic PII matching (email, phone, Luhn payment card, SSN-like, IPv4);
 * a detector hit masks the whole text node or input value. Opt in
 * explicitly; `balanced` and `strict` do not enable these detectors on
 * their own.
 */
export const getRecordPrivacyDetectorsPlugin: (
  options?: PrivacyDetectorsPluginOptions,
) => RecordPlugin<PrivacyDetectorsPluginOptions> = (options = {}) => {
  const _options = { ...DEFAULT_PRIVACY_DETECTORS, ...options };

  return {
    name: PLUGIN_NAME,
    applyPrivacyPolicy(policy) {
      const portable = (policy as PrivacyPolicy | undefined) || {
        version: 1 as const,
        preset: 'legacy' as const,
      };
      return applyPrivacyDetectors(portable, _options);
    },
    options: _options,
  };
};
