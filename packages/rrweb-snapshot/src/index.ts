import snapshot, {
  serializeNodeWithId,
  transformAttribute,
  ignoreAttribute,
  slimDOMDefaults,
  visitSnapshot,
  cleanupSnapshot,
  needMaskingText,
  splitMaskAllSelector,
  type MaskTextSelector,
  classMatchesRegex,
  IGNORED_NODE,
  genId,
} from './snapshot';
import rebuild, {
  buildNodeWithSN,
  adaptCssForReplay,
  createCache,
  createSandboxedIframe,
  rebuildIntoSandboxedIframe,
} from './rebuild';
export * from './privacy';
export * from './types';
// Legacy broad export kept for compatibility. New internal imports should
// prefer snapshot-utils.ts / rebuild-utils.ts domain entrypoints.
export * from './utils';

export {
  snapshot,
  serializeNodeWithId,
  rebuild,
  createSandboxedIframe,
  rebuildIntoSandboxedIframe,
  buildNodeWithSN,
  adaptCssForReplay,
  createCache,
  transformAttribute,
  ignoreAttribute,
  slimDOMDefaults,
  visitSnapshot,
  cleanupSnapshot,
  needMaskingText,
  splitMaskAllSelector,
  classMatchesRegex,
  IGNORED_NODE,
  genId,
};
export type { MaskTextSelector };
