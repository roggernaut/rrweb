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

/** Heuristic PII matching over page text; opt in explicitly. See the README for input-occlusion rationale and known limitations. */
export const getRecordPrivacyDetectorsPlugin: (
  options?: PrivacyDetectorsPluginOptions,
) => RecordPlugin<PrivacyDetectorsPluginOptions> = (options = {}) => {
  const _options = { ...DEFAULT_PRIVACY_DETECTORS, ...options };

  return {
    name: PLUGIN_NAME,
    applyPrivacyPolicy(policy) {
      const portable = (policy as PrivacyPolicy | undefined) || {
        version: 1 as const,
        preset: 'manual' as const,
      };
      return applyPrivacyDetectors(portable, _options);
    },
    options: _options,
  };
};
