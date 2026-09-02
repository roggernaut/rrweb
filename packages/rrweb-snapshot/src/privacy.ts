import type {
  CompiledPrivacyPolicy,
  MaskAttributeFn,
  MaskTextFn,
  PrivacyPolicy,
  VendorCompatId,
} from './types';
import { parentElement, untaintedTagName } from '@rrweb/utils';

const NATIVE_MASK_CLASSES = '.rr-mask';
const NATIVE_UNMASK_CLASSES = '.rr-unmask';
const NATIVE_BLOCK_CLASSES = '.rr-block';

// Other tools' conventions, merged only under `vendorCompat` — `true` for
// every vendor here, or an array naming just the vendors to honor. Every
// token was verified against the vendor's official docs or open-source SDK;
// the source for each is in guide.md's "Vendor class recognition" table. A
// token whose vendor semantics hide only text joins the vendor's mask list;
// one that removes or placeholders the element's whole content joins its
// block list. No vendor's unmask/allow or input-ignore token is ever merged,
// under any form of the setting: `vendorCompat` may only add masking or
// blocking, never reveal, and `.rr-unmask` stays native-only.
const VENDOR_COMPAT: Record<
  VendorCompatId,
  { mask: string[]; block: string[] }
> = {
  mixpanel: { mask: ['.mp-mask'], block: ['.mp-block'] },
  fullstory: {
    // the -without-consent variants are masked until their consent API reveals
    mask: ['.fs-mask', '.fs-mask-without-consent'],
    block: ['.fs-exclude', '.fs-exclude-without-consent'],
  },
  amplitude: { mask: ['.amp-mask'], block: ['.amp-block'] },
  posthog: { mask: ['.ph-mask'], block: ['.ph-no-capture'] },
  sentry: {
    mask: ['.sentry-mask', '[data-sentry-mask]'],
    block: ['.sentry-block', '[data-sentry-block]'],
  },
  datadog: {
    // mask-user-input covers form values only there; text here
    mask: [
      '.dd-privacy-mask',
      '[data-dd-privacy="mask"]',
      '.dd-privacy-mask-user-input',
      '[data-dd-privacy="mask-user-input"]',
    ],
    block: ['.dd-privacy-hidden', '[data-dd-privacy="hidden"]'],
  },
  newrelic: {
    mask: ['.nr-mask', '[data-nr-mask]'],
    block: ['.nr-block', '[data-nr-block]'],
  },
  // Highlight / LaunchDarkly
  highlight: { mask: ['.highlight-mask'], block: ['.highlight-block'] },
  // [data-private] blocks under any value: placeholder, delete, lipsum
  logrocket: { mask: [], block: ['[data-private]', '._lr-hide'] },
  // text and images placeholdered; the class form is also documented
  hotjar: { mask: [], block: ['[data-hj-suppress]', '.data-hj-suppress'] },
  // Microsoft Clarity
  clarity: { mask: ['[data-clarity-mask]'], block: [] },
  smartlook: {
    // the data-recording-* legacy attributes are still honored by the bundle
    mask: ['[data-sl="mask"]', '[data-recording-sensitive]'],
    block: ['[data-sl="exclude"]', '[data-recording-disable]'],
  },
  openreplay: {
    // -masked/-htmlmasked are deprecated aliases, still honored
    mask: ['[data-openreplay-obscured]', '[data-openreplay-masked]'],
    block: ['[data-openreplay-hidden]', '[data-openreplay-htmlmasked]'],
  },
  contentsquare: {
    // encrypted capture there, masked here; blocked content is removed there
    mask: ['[data-cs-encrypt]'],
    block: ['[data-cs-mask]'],
  },
  heap: {
    // redact-attributes covers attribute values there; text here. The block
    // token is the attribute: the SDK selector is `[heap-ignore]`.
    mask: ['[data-heap-redact-text]', '[data-heap-redact-attributes]'],
    block: ['[heap-ignore]'],
  },
  mouseflow: {
    mask: ['.mf-masked', '[data-mf-replace]', '[data-mf-replace-inner]'],
    block: ['.mf-excluded'],
  },
  // text scrambled, images blanked; .losensitive is an alias
  luckyorange: { mask: [], block: ['.lo-sensitive', '.losensitive'] },
  inspectlet: {
    mask: ['.inspectlet-sensitive', '.inspectletIgnore'],
    block: [],
  },
  dynatrace: { mask: ['[data-dtrum-mask]'], block: [] },
  userback: { mask: [], block: ['.userback-block'] },
  zipy: { mask: [], block: ['.zipy-block'] },
  quantummetric: {
    // encrypted capture there, masked here; qm-block is a customer-config
    // convention, qm-freeze-exclude the DOM-capture exclude
    mask: ['[data-qm-encrypt]'],
    block: ['[data-qm-block]', '[data-qm-freeze-exclude]'],
  },
  // input value mask
  glassbox: { mask: ['.cls_mask'], block: [] },
  sessionstack: { mask: ['.sessionstack-sensitive'], block: [] },
  sessionrewind: { mask: ['[data-sr-redact]'], block: [] },
};

const VENDOR_IDS = Object.keys(VENDOR_COMPAT) as VendorCompatId[];

/** The vendors a `vendorCompat` setting names; an unknown id is dropped with a warning, mirroring invalid-selector handling. */
function resolveVendorCompat(
  vendorCompat: PrivacyPolicy['vendorCompat'],
): VendorCompatId[] {
  if (vendorCompat === true) return VENDOR_IDS;
  if (!Array.isArray(vendorCompat)) return [];
  const known: VendorCompatId[] = [];
  const unknown: string[] = [];
  for (const id of vendorCompat) {
    if (Object.prototype.hasOwnProperty.call(VENDOR_COMPAT, id)) {
      known.push(id);
    } else {
      unknown.push(String(id));
    }
  }
  if (unknown.length)
    console.warn(
      `[rrweb privacy] dropping unknown vendorCompat id: ${unknown.join(', ')}`,
    );
  return known;
}

function vendorCompatSelector(
  vendors: VendorCompatId[],
  action: 'mask' | 'block',
): string | null {
  const tokens: string[] = [];
  for (const id of vendors) tokens.push(...VENDOR_COMPAT[id][action]);
  return tokens.join(',') || null;
}

// `data-privacy` fails closed: the mask token is the bare attribute minus the
// two values that mean something else, so an unrecognized value masks.
const DATA_PRIVACY = '[data-privacy]';
const DATA_PRIVACY_MASK =
  '[data-privacy]:not([data-privacy="unmask"]):not([data-privacy="block"])';
const DATA_PRIVACY_UNMASK = '[data-privacy="unmask"]';
const DATA_PRIVACY_BLOCK = '[data-privacy="block"]';
const DATA_PRIVACY_IGNORE = '[data-privacy="ignore"]';

const PRIVACY_PRESETS = new Set(['strict', 'balanced', 'minimal']);
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
    if (!maskTextFn) return starText(value);
    // A callback that throws or returns a non-string fails closed to stars.
    let masked: unknown;
    try {
      masked = maskTextFn(value, parent);
    } catch {
      return starText(value);
    }
    return typeof masked === 'string' ? masked : starText(value);
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
  // No document to ask (SSR, a worker, a non-DOM test harness): assume valid
  // rather than dropping every selector the policy declared. `matches()` is
  // wrapped in a catch-to-mask at capture time, which stays the fail-closed
  // backstop for anything actually malformed.
  if (typeof document === 'undefined') return true;
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/** @internal exported for direct unit testing; not part of the privacy API. */
export function splitSelectorList(selector: string): string[] {
  // A quote or opener that never closes is demoted to plain text and the
  // scan restarts, so one malformed fragment cannot swallow the separators
  // after it; a stray closer is simply ignored. Each restart demotes one more
  // index, so the loop is bounded by the selector's length.
  const demoted = new Set<number>();
  for (;;) {
    const parts: string[] = [];
    const openers: number[] = [];
    let quote: string | null = null;
    let quoteAt = -1;
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
      if (demoted.has(index)) continue;
      if (char === '"' || char === "'") {
        quote = char;
        quoteAt = index;
      } else if (char === '(' || char === '[') openers.push(index);
      else if (char === ')' || char === ']') openers.pop();
      else if (char === ',' && openers.length === 0) {
        parts.push(selector.slice(start, index));
        start = index + 1;
      }
    }
    if (quote) {
      demoted.add(quoteAt);
      continue;
    }
    if (openers.length) {
      demoted.add(openers[openers.length - 1]);
      continue;
    }
    parts.push(selector.slice(start));
    return parts;
  }
}

function joinSelectors(
  selectors: Array<string | null | undefined>,
): string | null {
  const kept = new Set<string>();
  for (const s of selectors) {
    if (!s) continue;
    const fragments = splitSelectorList(s);
    if (validateSelector(s)) {
      for (const part of fragments) {
        const trimmed = part.trim();
        if (trimmed) kept.add(trimmed);
      }
      continue;
    }
    // One malformed fragment used to take the whole comma-separated list with
    // it, silently un-masking everything the surviving fragments covered.
    // Re-validate fragment by fragment and keep the ones that stand alone.
    const dropped: string[] = [];
    for (const part of fragments) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (validateSelector(trimmed)) kept.add(trimmed);
      else dropped.push(trimmed);
    }
    if (dropped.length)
      console.warn(
        `[rrweb privacy] dropping invalid selector: ${dropped.join(', ')}`,
      );
  }
  return [...kept].join(',') || null;
}

export function compilePrivacyPolicy(
  policy?: PrivacyPolicy,
): CompiledPrivacyPolicy {
  const effective: PrivacyPolicy = policy || { version: 1, preset: 'minimal' };
  if (effective.version !== 1)
    throw new Error(
      `Unsupported Privacy at Capture policy version: ${String(
        effective.version,
      )}`,
    );
  if (!PRIVACY_PRESETS.has(effective.preset))
    throw new Error(`Unsupported privacy preset: ${String(effective.preset)}`);
  const preset = effective.preset;
  const managed = preset !== 'minimal';
  const compatVendors = resolveVendorCompat(effective.vendorCompat);
  if (compatVendors.length && !managed)
    console.warn(
      '[rrweb privacy] vendorCompat has no effect under the minimal preset; use balanced or strict, or add the classes as mask/block rules.',
    );
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

  // Under `minimal` the rules compile to their bare selectors and nothing
  // else: `data-privacy` and the native `rr-*` class conventions are
  // managed-preset features, and a `mask`/`block` rule does not switch them
  // on. (`.rr-mask`/`.rr-block` still reach `minimal` recordings through the
  // separate `maskTextClass`/`blockClass` options.)
  return {
    preset,
    maskTextSelector: managed
      ? preset === 'strict'
        ? '*'
        : joinSelectors([
            DATA_PRIVACY_MASK,
            NATIVE_MASK_CLASSES,
            vendorCompatSelector(compatVendors, 'mask'),
            ...bySelector.mask,
          ])
      : joinSelectors(bySelector.mask),
    unmaskTextSelector: joinSelectors(
      managed
        ? [DATA_PRIVACY_UNMASK, NATIVE_UNMASK_CLASSES, ...bySelector.unmask]
        : bySelector.unmask,
    ),
    blockSelector: joinSelectors(
      managed
        ? [
            DATA_PRIVACY_BLOCK,
            NATIVE_BLOCK_CLASSES,
            vendorCompatSelector(compatVendors, 'block'),
            ...bySelector.block,
          ]
        : bySelector.block,
    ),
    ignoreSelector: managed ? DATA_PRIVACY_IGNORE : null,
    maskAllInputs: managed,
    maskedAttributes,
    attributePolicyInert: !blockMedia && maskedAttributes.size === 0,
    blockMedia,
  };
}

/**
 * Whether input events from `element`'s subtree are suppressed entirely: the
 * nearest `data-privacy` annotation, ancestor-or-self, is `ignore`. A nearer
 * annotation of any other value overrides, per the severity ladder
 * `unmask, mask, ignore, block`. Any throw fails closed to suppression.
 */
export function isEventIgnored(
  element: Element,
  privacy: CompiledPrivacyPolicy | undefined,
): boolean {
  if (!privacy?.ignoreSelector) return false;
  try {
    const annotated = element.closest(DATA_PRIVACY);
    return annotated !== null && annotated.matches(privacy.ignoreSelector);
  } catch {
    return true;
  }
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
  const mergedMaskTextSelector = mergeSelectors(
    maskTextSelector,
    base.maskTextSelector,
  );
  const mergedUnmaskTextSelector = mergeSelectors(
    unmaskTextSelector,
    base.unmaskTextSelector,
  );
  // Both merged selectors are written back so `finalizeAttribute`, which
  // reads the policy, resolves mask/unmask ties with the same lists text does.
  const unchanged =
    mergedMaskTextSelector === base.maskTextSelector &&
    mergedUnmaskTextSelector === base.unmaskTextSelector;
  return {
    privacy: unchanged
      ? base
      : {
          ...base,
          maskTextSelector: mergedMaskTextSelector,
          unmaskTextSelector: mergedUnmaskTextSelector,
        },
    blockSelector: mergeSelectors(blockSelector, base.blockSelector),
    maskTextSelector: mergedMaskTextSelector,
    unmaskTextSelector: mergedUnmaskTextSelector,
  };
}

let maskAttributeConflictWarned = false;

/** Occludes a value to its length; contrast `starText`, which preserves whitespace/layout. */
export function stars(value: string): string {
  return '*'.repeat(value.length);
}

/** The mask selector without the `'*'` mask-everything fallback, which is a default rather than a marker and so never takes part in a tie. */
function concreteMaskSelector(privacy: CompiledPrivacyPolicy): string | null {
  const selector = privacy.maskTextSelector;
  if (!selector) return null;
  if (selector.indexOf('*') === -1) return selector;
  const kept = splitSelectorList(selector)
    .map((part) => part.trim())
    .filter((part) => part && part !== '*');
  return kept.join(',') || null;
}

/**
 * Attributes resolve like text: the nearest annotated ancestor decides, and
 * on the same element mask beats unmask. Any throw keeps the attribute masked.
 */
function isUnmasked(
  element: Element,
  privacy: CompiledPrivacyPolicy,
  memo?: UnmaskMemo,
): boolean {
  if (!privacy.unmaskTextSelector) return false;
  if (memo && memo.element === element) return memo.answer;
  let answer = false;
  try {
    const mask = concreteMaskSelector(privacy);
    let current: Element | null = element;
    while (current) {
      if (mask && current.matches(mask)) break;
      if (current.matches(privacy.unmaskTextSelector)) {
        answer = true;
        break;
      }
      current = parentElement(current);
    }
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
