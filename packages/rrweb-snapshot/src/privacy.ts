import type {
  CompiledPrivacyPolicy,
  MaskAttributeFn,
  MaskTextFn,
  PrivacyPolicy,
} from './types';
import { untaintedTagName } from '@rrweb/utils';

const NATIVE_MASK_CLASSES = '.rr-mask';
const NATIVE_UNMASK_CLASSES = '.rr-unmask';
const NATIVE_BLOCK_CLASSES = '.rr-block';

// Other tools' conventions, merged only under `vendorCompat`.
// See guide.md's "Vendor class recognition" section.
const COMPAT_MASK_CLASSES =
  '.mp-mask,.fs-mask,.amp-mask,.ph-mask,.sentry-mask,[data-sentry-mask],.dd-privacy-mask,[data-dd-privacy="mask"],.dd-privacy-mask-user-input,[data-dd-privacy="mask-user-input"],.nr-mask,[data-nr-mask]';
const COMPAT_UNMASK_CLASSES = '.amp-unmask';
const COMPAT_BLOCK_CLASSES =
  '.mp-block,.fs-exclude,.amp-block,.ph-no-capture,.sentry-block,.dd-privacy-hidden,[data-dd-privacy="hidden"],.nr-block,[data-nr-block]';

// `data-privacy` fails closed: the mask token is the bare attribute minus the
// two values that mean something else, so an unrecognized value masks.
const DATA_PRIVACY_MASK =
  '[data-privacy]:not([data-privacy="unmask"]):not([data-privacy="block"])';
const DATA_PRIVACY_UNMASK = '[data-privacy="unmask"]';
const DATA_PRIVACY_BLOCK = '[data-privacy="block"]';

const PRIVACY_PRESETS = new Set(['strict', 'balanced', 'manual']);
const MASKED_ATTRIBUTE_DEFAULTS = ['title', 'placeholder', 'aria-label'];

const CSS_ATTRIBUTES = new Set(['style', '_csstext']);

const RENDERING_METADATA_ATTRIBUTES = new Set([
  'rr_width',
  'rr_height',
  'rr_scrollleft',
  'rr_scrolltop',
  'rr_mediastate',
  'rr_open_mode',
]);

const OPERATIONAL_ATTRIBUTES = new Set(['data-privacy', 'data-rr-is-password']);

/** Attributes that point at media bytes; dropped entirely under `strict`. */
const MEDIA_SOURCE_ATTRIBUTES = new Set([
  'background',
  'data',
  'poster',
  'rr_src',
  'src',
  'srcset',
]);

const MEDIA_TAGS = new Set([
  'AUDIO',
  'EMBED',
  'IFRAME',
  'IMG',
  'OBJECT',
  'SOURCE',
  'VIDEO',
]);

const MEDIA_PLACEHOLDER_ATTRIBUTES = new Map([
  ['IMG', new Set(['src', 'srcset', 'poster'])],
  ['VIDEO', new Set(['poster'])],
]);

const PLAIN_PIXEL_DIMENSION = /^\d{1,5}$/;

export const FORM_VALUE_TAGS = new Set([
  'INPUT',
  'OPTION',
  'SELECT',
  'TEXTAREA',
]);

/** Occludes text content, preserving whitespace so layout survives; contrast `stars`, which occludes to length. */
function starText(value: string): string {
  return value.replace(/[\S]/g, '*');
}

/** The single decision point for text content, on both the snapshot and the mutation path. */
export function resolveTextValue({
  value,
  parent,
  parentTagName,
  needsMask,
  maskTextFn,
  exemptScript,
}: {
  value: string;
  /** Source of the STYLE/SCRIPT exemptions and the element passed to `maskTextFn`. */
  parent: HTMLElement | null;
  /** `untaintedTagName(parent)`, if the caller already computed it (hot path). */
  parentTagName?: string;
  needsMask: boolean;
  maskTextFn: MaskTextFn | undefined;
  exemptScript: boolean;
}): string {
  if (!value) return value;
  const tagName = parentTagName ?? untaintedTagName(parent);
  if (tagName === 'STYLE') return value;
  if (needsMask) {
    if (tagName === 'SCRIPT' && exemptScript) return value;
    return maskTextFn ? maskTextFn(value, parent) : starText(value);
  }
  return value;
}

/** Whether `toDataURL` may run: not under `blockMedia`, and not alongside a configured canvas masking provider. */
export function shouldCapturePixels(
  privacy: CompiledPrivacyPolicy | undefined,
  canvasMaskingConfigured?: () => boolean,
): boolean {
  return !privacy?.blockMedia && !canvasMaskingConfigured?.();
}

export function validateSelector(selector: string): boolean {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/** @internal exported for direct unit testing; not part of the privacy API. */
export function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(selector.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts;
}

function joinSelectors(
  selectors: Array<string | null | undefined>,
): string | null {
  const kept = new Set<string>();
  for (const s of selectors) {
    if (!s) continue;
    if (!validateSelector(s)) {
      console.warn(`[rrweb privacy] dropping invalid selector: ${s}`);
      continue;
    }
    for (const part of splitSelectorList(s)) {
      const trimmed = part.trim();
      if (trimmed) kept.add(trimmed);
    }
  }
  return [...kept].join(',') || null;
}

export function compilePrivacyPolicy(
  policy?: PrivacyPolicy,
): CompiledPrivacyPolicy {
  const effective: PrivacyPolicy = policy || { version: 1, preset: 'manual' };
  if (effective.version !== 1)
    throw new Error(
      `Unsupported Privacy at Capture policy version: ${String(
        effective.version,
      )}`,
    );
  if (!PRIVACY_PRESETS.has(effective.preset))
    throw new Error(`Unsupported privacy preset: ${String(effective.preset)}`);
  const preset = effective.preset;
  const managed = preset !== 'manual';
  const vendorCompat = effective.vendorCompat === true;
  const maskedAttributes = new Set(managed ? MASKED_ATTRIBUTE_DEFAULTS : []);
  const blockMedia = preset === 'strict';

  const bySelector = {
    mask: [] as string[],
    unmask: [] as string[],
    block: [] as string[],
  };
  for (const rule of effective.rules || []) {
    if (
      !rule.target ||
      rule.target.type !== 'selector' ||
      !rule.target.selector
    )
      throw new Error('Privacy rules require a non-empty selector target');
    if (!Object.prototype.hasOwnProperty.call(bySelector, rule.action))
      throw new Error(`Unsupported privacy action: ${String(rule.action)}`);
    bySelector[rule.action].push(rule.target.selector);
  }

  return {
    preset,
    maskTextSelector: managed
      ? preset === 'strict'
        ? '*'
        : joinSelectors([
            DATA_PRIVACY_MASK,
            NATIVE_MASK_CLASSES,
            vendorCompat ? COMPAT_MASK_CLASSES : null,
            ...bySelector.mask,
          ])
      : joinSelectors(
          bySelector.mask.length ? [DATA_PRIVACY_MASK, ...bySelector.mask] : [],
        ),
    unmaskTextSelector: joinSelectors(
      managed
        ? [
            DATA_PRIVACY_UNMASK,
            NATIVE_UNMASK_CLASSES,
            vendorCompat ? COMPAT_UNMASK_CLASSES : null,
            ...bySelector.unmask,
          ]
        : bySelector.unmask,
    ),
    blockSelector: joinSelectors(
      managed
        ? [
            DATA_PRIVACY_BLOCK,
            NATIVE_BLOCK_CLASSES,
            vendorCompat ? COMPAT_BLOCK_CLASSES : null,
            ...bySelector.block,
          ]
        : bySelector.block.length
        ? [DATA_PRIVACY_BLOCK, ...bySelector.block]
        : [],
    ),
    maskAllInputs: managed,
    maskedAttributes,
    attributePolicyInert: !blockMedia && maskedAttributes.size === 0,
    blockMedia,
  };
}

/** Validates and merges a `record()`-level selector with the compiled policy's; invalid fragments are dropped with a warning. */
export function mergeSelectors(
  manualSelector: string | null | undefined,
  compiledSelector: string | null | undefined,
): string | null {
  return joinSelectors([manualSelector, compiledSelector]);
}

/** The privacy state one recording pass (or one `snapshot()` call) runs on. */
export type PrivacyContext = {
  privacy: CompiledPrivacyPolicy;
  blockSelector: string | null;
  maskTextSelector: string | null;
  unmaskTextSelector: string | null;
};

/** The one privacy prologue: compile the policy, merge every `record()`-level selector with its compiled counterpart, and write the merged unmask selector back onto the policy. */
export function resolvePrivacyContext({
  privacy: compiled,
  privacyPolicy,
  blockSelector = null,
  maskTextSelector = null,
  unmaskTextSelector = null,
}: {
  privacy?: CompiledPrivacyPolicy;
  privacyPolicy?: PrivacyPolicy;
  blockSelector?: string | null;
  maskTextSelector?: string | null;
  unmaskTextSelector?: string | null;
}): PrivacyContext {
  const base = compiled || compilePrivacyPolicy(privacyPolicy);
  const mergedUnmaskTextSelector = mergeSelectors(
    unmaskTextSelector,
    base.unmaskTextSelector,
  );
  return {
    privacy:
      mergedUnmaskTextSelector === base.unmaskTextSelector
        ? base
        : { ...base, unmaskTextSelector: mergedUnmaskTextSelector },
    blockSelector: mergeSelectors(blockSelector, base.blockSelector),
    maskTextSelector: mergeSelectors(maskTextSelector, base.maskTextSelector),
    unmaskTextSelector: mergedUnmaskTextSelector,
  };
}

let maskAttributeConflictWarned = false;

/** Occludes a value to its length; contrast `starText`, which preserves whitespace/layout. */
export function stars(value: string): string {
  return '*'.repeat(value.length);
}

function isUnmasked(
  element: Element,
  privacy: CompiledPrivacyPolicy,
  memo?: UnmaskMemo,
): boolean {
  if (!privacy.unmaskTextSelector) return false;
  if (memo && memo.element === element) return memo.answer;
  let answer: boolean;
  try {
    answer = !!element.closest(privacy.unmaskTextSelector);
  } catch {
    answer = false;
  }
  if (memo) {
    memo.element = element;
    memo.answer = answer;
  }
  return answer;
}

/** One element's `isUnmasked` answer, reused across its whole attribute sweep. */
type UnmaskMemo = { element: Element | null; answer: boolean };

const URI_UNSAFE = /[<>#]/g;
const URI_ESCAPES: Record<string, string> = {
  '<': '%3C',
  '>': '%3E',
  '#': '%23',
};
const placeholderCache = new Map<string, string>();

function placeholderImage(width: string, height: string): string {
  const key = `${width}x${height}`;
  const cached = placeholderCache.get(key);
  if (cached !== undefined) return cached;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="#ddd"/></svg>`;
  const encoded = `data:image/svg+xml;utf8,${svg.replace(
    URI_UNSAFE,
    (char) => URI_ESCAPES[char],
  )}`;
  if (placeholderCache.size < 100) placeholderCache.set(key, encoded);
  return encoded;
}

function declaredDimensions(element: Element): [string, string] | null {
  try {
    const width = element.getAttribute('width');
    const height = element.getAttribute('height');
    if (width === null || height === null) return null;
    if (
      !PLAIN_PIXEL_DIMENSION.test(width) ||
      !PLAIN_PIXEL_DIMENSION.test(height)
    )
      return null;
    return [width, height];
  } catch {
    return null;
  }
}

function blockedMediaValue(
  element: Element,
  tagName: string,
  normalizedName: string,
): string | null {
  const placeholderNames = MEDIA_PLACEHOLDER_ATTRIBUTES.get(tagName);
  if (!placeholderNames || !placeholderNames.has(normalizedName)) return null;
  const dimensions = declaredDimensions(element);
  if (!dimensions) return null;
  return placeholderImage(dimensions[0], dimensions[1]);
}

/** The single decision point for every attribute rrweb records, called once per attribute at the end of serialization. */
export function finalizeAttribute({
  element,
  name,
  value,
  privacy,
  maskAllElementAttributes = false,
  maskAttributeFn,
  isGenerated = false,
  unmaskMemo,
}: {
  element: Element;
  name: string;
  value: string | null;
  privacy: CompiledPrivacyPolicy | undefined;
  maskAllElementAttributes?: boolean;
  maskAttributeFn?: MaskAttributeFn;
  isGenerated?: boolean;
  /** @internal see `UnmaskMemo`; supplied by `finalizeAttributes` */
  unmaskMemo?: UnmaskMemo;
}): string | null {
  if (
    !maskAllElementAttributes &&
    !maskAttributeFn &&
    (!privacy || privacy.attributePolicyInert)
  )
    return value;
  if (value === null || value === '') return value;

  const normalizedName = name.toLowerCase();
  if (isGenerated && RENDERING_METADATA_ATTRIBUTES.has(normalizedName))
    return value;
  if (OPERATIONAL_ATTRIBUTES.has(normalizedName)) return value;
  if (CSS_ATTRIBUTES.has(normalizedName)) return value;

  if (maskAllElementAttributes) {
    if (maskAttributeFn && !maskAttributeConflictWarned) {
      maskAttributeConflictWarned = true;
      console.warn(
        '[rrweb privacy] maskAllElementAttributes is set; maskAttributeFn is ignored.',
      );
    }
    return stars(value);
  }

  let current = value;
  if (maskAttributeFn) {
    try {
      const masked = maskAttributeFn(name, value, element);
      current = typeof masked === 'string' ? masked : stars(value);
    } catch {
      return stars(value);
    }
  }

  if (!privacy) return current;

  if (privacy.blockMedia && MEDIA_SOURCE_ATTRIBUTES.has(normalizedName)) {
    const tagName = untaintedTagName(element);
    if (MEDIA_TAGS.has(tagName))
      return blockedMediaValue(element, tagName, normalizedName);
  }
  if (privacy.maskedAttributes.has(normalizedName)) {
    return isUnmasked(element, privacy, unmaskMemo) ? current : stars(current);
  }
  if (
    normalizedName === 'value' &&
    privacy.preset === 'strict' &&
    FORM_VALUE_TAGS.has(untaintedTagName(element))
  ) {
    return stars(current);
  }
  return current;
}

/** Runs every attribute through `finalizeAttribute` once, in place, after serialization. */
export function finalizeAttributes(
  attributes: Record<string, unknown>,
  {
    element,
    privacy,
    maskAllElementAttributes,
    maskAttributeFn,
    generatedAttributes,
  }: {
    element: Element;
    privacy: CompiledPrivacyPolicy | undefined;
    maskAllElementAttributes?: boolean;
    maskAttributeFn?: MaskAttributeFn;
    /** names this serializer wrote itself; see `finalizeAttribute`'s step 1 */
    generatedAttributes?: Set<string>;
  },
): void {
  const unmaskMemo: UnmaskMemo = { element: null, answer: false };
  for (const name in attributes) {
    const value = attributes[name];
    if (typeof value !== 'string' && value !== null) continue;
    attributes[name] = finalizeAttribute({
      element,
      name,
      value,
      privacy,
      maskAllElementAttributes,
      maskAttributeFn,
      isGenerated: generatedAttributes?.has(name),
      unmaskMemo,
    });
  }
}
