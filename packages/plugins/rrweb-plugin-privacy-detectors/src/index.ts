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
 * Highlight-style heuristic PII matching (email, phone, Luhn payment card,
 * SSN-like, IPv4). Opt in explicitly; `balanced` and `strict` do not enable
 * these detectors on their own.
 */
export const getRecordPrivacyDetectorsPlugin: (
  options?: PrivacyDetectorsPluginOptions,
) => RecordPlugin<PrivacyDetectorsPluginOptions> = (options = {}) => {
  const _options = { ...DEFAULT_PRIVACY_DETECTORS, ...options };

  return {
    name: PLUGIN_NAME,
    applyPrivacyPolicy(policy) {
      return applyPrivacyDetectors(
        policy as PrivacyPolicy | undefined,
        _options,
      );
    },
    options: _options,
  };
};
