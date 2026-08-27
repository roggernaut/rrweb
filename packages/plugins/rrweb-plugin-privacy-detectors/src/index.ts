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
 * Heuristic PII matching (email, phone, Luhn payment card, SSN-like, IPv4)
 * over **page text**; a detector hit masks the whole text node. Opt in
 * explicitly; `balanced` and `strict` do not enable these detectors on
 * their own.
 *
 * Input values are never scanned. The policy this plugin produces compiles
 * to `maskAllInputs: true` whatever preset it started from -- including a
 * bare `legacy` base -- so every input value is occluded to its length while
 * the plugin is loaded. Scanning a value as it is typed would record every
 * raw prefix before a pattern could match (a card number is reconstructable
 * from the keystrokes preceding the first Luhn-valid length), and a value
 * that scans clean at every length would still be disclosed along with every
 * kind of PII this fixed pattern set does not model.
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
