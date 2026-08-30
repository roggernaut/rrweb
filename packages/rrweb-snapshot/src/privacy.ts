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
// the source for each is in guide.md's "Vendor class recognition" table.
// The mapping rule: each token maps to the closest treatment our verbs
// express (mask, block, ignoreEvents), never a less protective one.
// `ignoreEvents` tokens suppress input events from the annotated element
// only, exactly as the vendor's own recorder does — they never imply
// masking, unlike `data-privacy="ignore"`, which is mask plus silence. No
// vendor's unmask/allow token is ever merged, under any form of the
// setting: `vendorCompat` may only reduce what is recorded, never reveal,
// and `.rr-unmask` stays native-only.
/** @internal exported for the registry invariant tests; not part of the privacy API. */
export const VENDOR_COMPAT: Record<
  VendorCompatId,
  { mask: string[]; block: string[]; ignoreEvents?: string[] }
> = {
  mixpanel: { mask: ['.mp-mask'], block: ['.mp-block'] },
  fullstory: {
    // the -without-consent variants are masked until their consent API reveals
    mask: ['.fs-mask', '.fs-mask-without-consent'],
    block: ['.fs-exclude', '.fs-exclude-without-consent'],
  },
  amplitude: { mask: ['.amp-mask'], block: ['.amp-block'] },
  posthog: {
    // posthog-js lazy-loaded-session-recorder.ts: ph-mask -> maskTextClass,
    // ph-no-capture -> blockClass, ph-ignore-input -> ignoreClass
    mask: ['.ph-mask'],
    block: ['.ph-no-capture'],
    ignoreEvents: ['.ph-ignore-input'],
  },
  sentry: {
    // sentry-javascript replay-internal/src/util/getPrivacyOptions.ts
    mask: ['.sentry-mask', '[data-sentry-mask]'],
    block: ['.sentry-block', '[data-sentry-block]'],
    ignoreEvents: ['.sentry-ignore', '[data-sentry-ignore]'],
  },
  datadog: {
    // browser-sdk browser-rum-core/src/domain/privacy.ts: mask-user-input
    // masks form values (and form-element text such as <option> labels)
    // only there; mapped to text mask here because form values are already
    // masked globally wherever compat applies (`maskAllInputs`), and
    // dropping the token would record the form-element text it protects
    mask: [
      '.dd-privacy-mask',
      '[data-dd-privacy="mask"]',
      '.dd-privacy-mask-user-input',
      '[data-dd-privacy="mask-user-input"]',
    ],
    block: ['.dd-privacy-hidden', '[data-dd-privacy="hidden"]'],
  },
  newrelic: {
    // newrelic-browser-agent src/common/config/init.js: nr-mask/[data-nr-mask]
    // -> maskText, nr-block/[data-nr-block] -> block, nr-ignore -> ignoreClass
    // (class only; no attribute form ships)
    mask: ['.nr-mask', '[data-nr-mask]'],
    block: ['.nr-block', '[data-nr-block]'],
    ignoreEvents: ['.nr-ignore'],
  },
  // Highlight / LaunchDarkly: highlight-run client/index.tsx passes
  // blockClass 'highlight-block' and ignoreClass 'highlight-ignore' to its
  // rrweb fork, whose default maskTextClass is 'highlight-mask'
  highlight: {
    mask: ['.highlight-mask'],
    block: ['.highlight-block'],
    ignoreEvents: ['.highlight-ignore'],
  },
  // [data-private] blocks under any value: placeholder, delete, lipsum
  logrocket: { mask: [], block: ['[data-private]', '._lr-hide'] },
  // Text is masked in place there, but images/videos are placeholdered too
  // (help.hotjar.com "How to Suppress Text, Images, Videos and User Input");
  // our mask verb leaves image sources readable, so block stands. The class
  // form is also documented.
  hotjar: { mask: [], block: ['[data-hj-suppress]', '.data-hj-suppress'] },
  // Microsoft Clarity
  clarity: { mask: ['[data-clarity-mask]'], block: [] },
  smartlook: {
    // the data-recording-* legacy attributes survive only in archived docs
    // (smartlook.github.io "Sensitive data protection", via web.archive.org):
    // data-recording-sensitive masked text AND ignored input values/events
    // there, so it joins ignoreEvents alongside mask
    mask: ['[data-sl="mask"]', '[data-recording-sensitive]'],
    block: ['[data-sl="exclude"]', '[data-recording-disable]'],
    ignoreEvents: ['[data-recording-sensitive]'],
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
    // help.heap.io "What privacy settings does Session replay inherit":
    // both redact attributes redact the entire element in replay, so block.
    // [heap-ignore] suppresses autocapture events only and is absent from
    // the replay-inheritance list, so events-only. Tokens are attributes:
    // the SDK selects `[heap-ignore]`, not a class.
    mask: [],
    block: ['[data-heap-redact-text]', '[data-heap-redact-attributes]'],
    ignoreEvents: ['[heap-ignore]'],
  },
  mouseflow: {
    // help.mouseflow.com "Excluding, masking and replacing content via
    // code": mf-masked is "not recorded at all" and data-mf-replace swaps
    // the subtree for its placeholder value, so both block; only
    // data-mf-replace-inner keeps the structure (inner text replaced)
    mask: ['[data-mf-replace-inner]'],
    block: ['.mf-excluded', '.mf-masked', '[data-mf-replace]'],
  },
  // text scrambled, images blanked; .losensitive is an alias
  luckyorange: { mask: [], block: ['.lo-sensitive', '.losensitive'] },
  inspectlet: {
    mask: ['.inspectlet-sensitive', '.inspectletIgnore'],
    block: [],
  },
  dynatrace: { mask: ['[data-dtrum-mask]'], block: [] },
  userback: {
    // support.userback.io "Session replay": userback-block ignores the
    // element and its children entirely; userback-ignore keeps the element
    // rendered and ignores its user input, so events-only
    mask: [],
    block: ['.userback-block'],
    ignoreEvents: ['.userback-ignore'],
  },
  zipy: { mask: [], block: ['.zipy-block'] },
  quantummetric: {
    // observed-only: docs are login-gated, tokens read from the shipped
    // engine. Encrypted capture there, masked here; qm-block is a
    // customer-config convention, qm-freeze-exclude the DOM-capture exclude
    mask: ['[data-qm-encrypt]'],
    block: ['[data-qm-block]', '[data-qm-freeze-exclude]'],
  },
  // observed-only: read from the shipped SDK; the official docs are
  // customer-gated with no public or archived copy to verify against
  glassbox: { mask: ['.cls_mask'], block: [] },
  sessionstack: { mask: ['.sessionstack-sensitive'], block: [] },
  sessionrewind: {
    // sessionrewind.notion.site "Privacy settings": the documented verb is
    // "exclude"/"redact" for arbitrary elements, replay rendering
    // unspecified — so the stricter verb
    mask: [],
    block: ['[data-sr-redact]'],
  },
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
  action: 'mask' | 'block' | 'ignoreEvents',
): string | null {
  const tokens: string[] = [];
  for (const id of vendors) tokens.push(...(VENDOR_COMPAT[id][action] ?? []));
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

const URL_ATTRIBUTES = new Set([
  'action',
  'background',
  'data',
  'formaction',
  'href',
  'poster',
  'rr_src',
  'src',
  'xlink:href',
]);

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

const DEFAULT_BLOCKED_QUERY_PARAMETERS = [
  'access_token',
  'auth',
  'code',
  'key',
  'password',
  'secret',
  'session',
  'token',
];

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
  // wrapped in a catch at capture time that masks (text, attributes) or
  // blocks (block selectors), which stays the fail-closed backstop for
  // anything actually malformed.
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
  const sanitizeUrls = managed;

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
    ignoreEventsSelector: managed
      ? joinSelectors([vendorCompatSelector(compatVendors, 'ignoreEvents')])
      : null,
    maskAllInputs: managed,
    maskedAttributes,
    attributePolicyInert:
      !blockMedia && !sanitizeUrls && maskedAttributes.size === 0,
    blockMedia,
    sanitizeUrls,
    blockedQueryParameters: new Set(
      [
        ...DEFAULT_BLOCKED_QUERY_PARAMETERS,
        ...(effective.url?.blockedQueryParameters || []),
      ].map((n) => n.toLowerCase()),
    ),
    allowedQueryParameters: effective.url?.allowedQueryParameters
      ? new Set(
          effective.url.allowedQueryParameters.map((n) => n.toLowerCase()),
        )
      : null,
    removeHash: effective.url?.removeHash !== false,
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
  if (!privacy) return false;
  // A vendorCompat ignore token silences events from the annotated element
  // itself, exactly as the vendor's own input observer does; it carries no
  // masking and takes no part in the data-privacy severity ladder below.
  if (privacy.ignoreEventsSelector) {
    try {
      if (element.matches(privacy.ignoreEventsSelector)) return true;
    } catch {
      return true;
    }
  }
  if (!privacy.ignoreSelector) return false;
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

// Everything a srcset parser reads as a delimiter is escaped too, so the
// placeholder is a valid candidate URL there and not just in `src`.
const URI_UNSAFE = /[<>#" ,]/g;
const URI_ESCAPES: Record<string, string> = {
  '<': '%3C',
  '>': '%3E',
  '#': '%23',
  '"': '%22',
  ' ': '%20',
  ',': '%2C',
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

/** Size attributes first; for an `<img>` the intrinsic size is the fallback. Never a layout measurement. */
function declaredDimensions(element: Element): [string, string] | null {
  try {
    const width = element.getAttribute('width');
    const height = element.getAttribute('height');
    if (
      width !== null &&
      height !== null &&
      PLAIN_PIXEL_DIMENSION.test(width) &&
      PLAIN_PIXEL_DIMENSION.test(height)
    )
      return [width, height];
    const { naturalWidth, naturalHeight } = element as HTMLImageElement;
    if (
      Number.isInteger(naturalWidth) &&
      Number.isInteger(naturalHeight) &&
      naturalWidth > 0 &&
      naturalHeight > 0
    )
      return [String(naturalWidth), String(naturalHeight)];
    return null;
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
  if (URL_ATTRIBUTES.has(normalizedName)) return sanitizeUrl(current, privacy);
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

/**
 * EXPERIMENTAL: no session-replay vendor sanitizes URLs in the recorded DOM;
 * see the changeset.
 *
 * `paramsMode` is an internal knob, not part of the public policy surface:
 * `'preset'` (the default) is `strict`'s normal mask-every-param-unless-
 * allowlisted behavior; `'blocklist'` forces the `balanced` treatment
 * (mask only `blockedQueryParameters`/non-`allowedQueryParameters`) even
 * under `strict`. `sanitizeMetaUrl` is the one caller that needs it -- see
 * its doc comment. This keeps the preset special-case inside the URL layer
 * instead of leaking a `strict`-vs-Meta branch into core.
 */
export function sanitizeUrl(
  value: string,
  privacy: CompiledPrivacyPolicy | undefined,
  { paramsMode = 'preset' }: { paramsMode?: 'preset' | 'blocklist' } = {},
): string | null {
  if (!value) return value;
  if (!privacy || !privacy.sanitizeUrls) return value;
  try {
    const url = new URL(value, 'https://rrweb.invalid');
    url.username = '';
    url.password = '';
    const maskAllParams =
      paramsMode === 'preset' &&
      privacy.preset === 'strict' &&
      !privacy.allowedQueryParameters;
    for (const [name] of url.searchParams) {
      const lower = name.toLowerCase();
      if (
        maskAllParams ||
        (privacy.allowedQueryParameters &&
          !privacy.allowedQueryParameters.has(lower)) ||
        privacy.blockedQueryParameters.has(lower)
      ) {
        url.searchParams.set(name, '*');
      }
    }
    if (privacy.removeHash) url.hash = '';
    if (url.origin === 'https://rrweb.invalid')
      return `${url.pathname}${url.search}${url.hash}`;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * EXPERIMENTAL, open design question for upstream: sanitizes the Meta
 * event's `window.location.href` with blocked-list-only parameter masking
 * (the `balanced` treatment), even under `strict`, where every other URL in
 * the recorded DOM masks every param unless explicitly allowlisted. The
 * Meta event's URL is the recording's own address bar, not markup the page
 * author wrote -- treating it identically to an arbitrary `<a href>` would
 * make `strict` unusable for reconstructing which page a session happened
 * on, since almost every app puts routing state in its own URL. Whether
 * that asymmetry is the right default, versus a dedicated option, is not
 * settled; see the changeset.
 */
export function sanitizeMetaUrl(
  value: string,
  privacy: CompiledPrivacyPolicy | undefined,
): string | null {
  return sanitizeUrl(value, privacy, { paramsMode: 'blocklist' });
}
