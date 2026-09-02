import type {
  CompiledDetector,
  CompiledPrivacyPolicy,
  MaskAttributeFn,
  MaskTextFn,
  PrivacyDetectorOptions,
  PrivacyPolicy,
} from './types';
import { untaintedTagName } from '@rrweb/utils';

const NATIVE_MASK_CLASSES = '.rr-mask';
const NATIVE_UNMASK_CLASSES = '.rr-unmask';
const NATIVE_BLOCK_CLASSES = '.rr-block';

// Other tools' conventions, merged only under `vendorCompat`. Every token was
// verified against the vendor's official docs or open-source SDK; the source
// for each is in guide.md's "Vendor class recognition" table. A token whose
// vendor semantics hide only text joins the mask list; one that removes or
// placeholders the element's whole content joins the block list. No vendor's
// unmask/allow or input-ignore token is ever merged: `vendorCompat` may only
// add masking or blocking, never reveal, and `.rr-unmask` stays native-only.
const COMPAT_MASK_CLASSES = [
  '.mp-mask', // Mixpanel
  '.fs-mask', // FullStory
  '.fs-mask-without-consent', // FullStory (masked until their consent API reveals)
  '.amp-mask', // Amplitude
  '.ph-mask', // PostHog
  '.sentry-mask', // Sentry
  '[data-sentry-mask]', // Sentry
  '.dd-privacy-mask', // Datadog
  '[data-dd-privacy="mask"]', // Datadog
  '.dd-privacy-mask-user-input', // Datadog (form values only there; text here)
  '[data-dd-privacy="mask-user-input"]', // Datadog
  '.nr-mask', // New Relic
  '[data-nr-mask]', // New Relic
  '.highlight-mask', // Highlight / LaunchDarkly
  '[data-clarity-mask]', // Microsoft Clarity
  '[data-sl="mask"]', // Smartlook
  '[data-openreplay-obscured]', // OpenReplay
  '[data-openreplay-masked]', // OpenReplay (deprecated alias, still honored)
  '[data-heap-redact-text]', // Heap
  '[data-heap-redact-attributes]', // Heap (attribute values there; text here)
  '[data-cs-encrypt]', // Contentsquare (encrypted capture there; masked here)
  '.mf-masked', // Mouseflow
  '[data-mf-replace]', // Mouseflow
  '[data-mf-replace-inner]', // Mouseflow
  '.inspectlet-sensitive', // Inspectlet
  '.inspectletIgnore', // Inspectlet
  '[data-dtrum-mask]', // Dynatrace
  '[data-qm-encrypt]', // Quantum Metric (encrypted capture there; masked here)
  '.cls_mask', // Glassbox (input value mask)
  '.sessionstack-sensitive', // SessionStack
  '[data-sr-redact]', // Session Rewind
  '[data-recording-sensitive]', // Smartlook legacy attribute, still honored
].join(',');
const COMPAT_BLOCK_CLASSES = [
  '.mp-block', // Mixpanel
  '.fs-exclude', // FullStory
  '.fs-exclude-without-consent', // FullStory
  '.amp-block', // Amplitude
  '.ph-no-capture', // PostHog
  '.sentry-block', // Sentry
  '[data-sentry-block]', // Sentry
  '.dd-privacy-hidden', // Datadog
  '[data-dd-privacy="hidden"]', // Datadog
  '.nr-block', // New Relic
  '[data-nr-block]', // New Relic
  '.highlight-block', // Highlight / LaunchDarkly
  '[data-private]', // LogRocket (any value: placeholder, delete, lipsum)
  '._lr-hide', // LogRocket (legacy)
  '[data-hj-suppress]', // Hotjar (text and images placeholdered)
  '.data-hj-suppress', // Hotjar (class form, also documented)
  '[data-sl="exclude"]', // Smartlook
  '[data-openreplay-hidden]', // OpenReplay
  '[data-openreplay-htmlmasked]', // OpenReplay (deprecated alias)
  '[data-cs-mask]', // Contentsquare (content removed from collection)
  '[heap-ignore]', // Heap (attribute; the SDK selector is `[heap-ignore]`)
  '.mf-excluded', // Mouseflow
  '.lo-sensitive', // Lucky Orange (text scrambled, images blanked)
  '.losensitive', // Lucky Orange (alias)
  '.userback-block', // Userback
  '.zipy-block', // Zipy
  '[data-qm-block]', // Quantum Metric (customer-config convention)
  '[data-qm-freeze-exclude]', // Quantum Metric (DOM-capture exclude)
  '[data-recording-disable]', // Smartlook legacy attribute, still honored
].join(',');

// `data-privacy` fails closed: the mask token is the bare attribute minus the
// two values that mean something else, so an unrecognized value masks.
const DATA_PRIVACY_MASK =
  '[data-privacy]:not([data-privacy="unmask"]):not([data-privacy="block"])';
const DATA_PRIVACY_UNMASK = '[data-privacy="unmask"]';
const DATA_PRIVACY_BLOCK = '[data-privacy="block"]';

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

const CARD_CANDIDATE = /(?:^|[^0-9-])((?:\d[ -]?){12,18}\d)(?:$|[^0-9-])/;
const SSN_PATTERN = /\b(?!000|666|9\d{2})\d{3}-?(?!00)\d{2}-?(?!0000)\d{4}\b/;
const EMAIL_PATTERN =
  /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63})+/;
const PHONE_PATTERN = /(?:^|\s)\+?\d{0,3}[\s.-]?\(?\d[\d ().-]{5,13}\d(?:$|\s)/;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const MAX_SCAN_LENGTH = 10_000;

export const DEFAULT_PRIVACY_DETECTORS: Required<PrivacyDetectorOptions> = {
  email: true,
  phone: true,
  paymentCard: true,
  ssn: true,
  ipAddress: true,
};

/** Opts into heuristic PII text detectors; see guide.md "Heuristic PII detectors". */
export function applyPrivacyDetectors(
  policy: PrivacyPolicy | undefined,
  options?: PrivacyDetectorOptions,
): PrivacyPolicy {
  const base: PrivacyPolicy = policy || { version: 1, preset: 'minimal' };
  return {
    ...base,
    detectors: {
      ...DEFAULT_PRIVACY_DETECTORS,
      ...options,
      ...base.detectors,
    },
  };
}

export function buildDetectors(
  options: PrivacyDetectorOptions | undefined,
): CompiledDetector[] {
  const opts = options || {};
  const detectors: CompiledDetector[] = [];
  if (opts.email)
    detectors.push({ name: 'email', test: (v) => EMAIL_PATTERN.test(v) });
  if (opts.phone)
    detectors.push({
      name: 'phone',
      test: (v) => {
        const m = PHONE_PATTERN.exec(v);
        if (!m) return false;
        const digits = m[0].replace(/\D/g, '');
        return digits.length >= 10 && digits.length <= 15;
      },
    });
  if (opts.paymentCard)
    detectors.push({
      name: 'payment-card',
      test: (v) => {
        const m = CARD_CANDIDATE.exec(v);
        return !!m && passesLuhn(m[1]);
      },
    });
  if (opts.ssn)
    detectors.push({ name: 'ssn', test: (v) => SSN_PATTERN.test(v) });
  if (opts.ipAddress)
    detectors.push({
      name: 'ip-address',
      test: (v) => {
        const m = IPV4_PATTERN.exec(v);
        return !!m && m[0].split('.').every((p) => Number(p) <= 255);
      },
    });
  return detectors;
}

/** Runs the compiled detectors over one text node or `characterData` mutation value. */
export function detectSensitiveValue(
  value: string,
  privacy: CompiledPrivacyPolicy,
): boolean {
  if (!privacy.detectors.length || !value) return false;
  if (value.length > MAX_SCAN_LENGTH) return true;
  const { detectors } = privacy;
  for (let index = 0; index < detectors.length; index += 1) {
    if (detectors[index].test(value)) return true;
  }
  return false;
}

/** Occludes non-whitespace to stars, preserving layout; contrast `stars`, which occludes to length. */
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
  privacy,
  exemptScript,
}: {
  value: string;
  /** Source of the STYLE/SCRIPT exemptions and the element passed to `maskTextFn`. */
  parent: HTMLElement | null;
  /** `untaintedTagName(parent)`, if the caller already computed it (hot path). */
  parentTagName?: string;
  needsMask: boolean;
  maskTextFn: MaskTextFn | undefined;
  privacy: CompiledPrivacyPolicy | undefined;
  exemptScript: boolean;
}): string {
  if (!value) return value;
  const tagName = parentTagName ?? untaintedTagName(parent);
  if (tagName === 'STYLE') return value;
  const isScript = tagName === 'SCRIPT';
  if (needsMask) {
    if (isScript && exemptScript) return value;
    return maskTextFn ? maskTextFn(value, parent) : starText(value);
  }
  if (isScript) return value;
  if (privacy && detectSensitiveValue(value, privacy)) return starText(value);
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

function matchesInDocumentOrOpenShadowRoots(
  root: Document | ShadowRoot,
  selector: string,
): boolean {
  if (root.querySelector(selector)) return true;
  const all = root.querySelectorAll('*');
  for (let index = 0; index < all.length; index += 1) {
    const sr = (all[index] as HTMLElement).shadowRoot;
    if (sr && matchesInDocumentOrOpenShadowRoots(sr, selector)) return true;
  }
  return false;
}

/** EXPERIMENTAL: resolves `unmaskTextSelector` to `null` when nothing in `doc` currently matches it; call once per flush, not per node. */
export function resolveUnmaskTextSelector(
  doc: Document,
  unmaskTextSelector: string | null,
): string | null {
  if (!unmaskTextSelector) return null;
  try {
    return matchesInDocumentOrOpenShadowRoots(doc, unmaskTextSelector)
      ? unmaskTextSelector
      : null;
  } catch {
    return unmaskTextSelector;
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
  const vendorCompat = effective.vendorCompat === true;
  const detectors = buildDetectors(effective.detectors);
  const maskAllInputs = managed || detectors.length > 0;
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
            vendorCompat ? COMPAT_MASK_CLASSES : null,
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
            vendorCompat ? COMPAT_BLOCK_CLASSES : null,
            ...bySelector.block,
          ]
        : bySelector.block,
    ),
    maskAllInputs,
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
    detectors,
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

export function passesLuhn(candidate: string): boolean {
  const digits = candidate.replace(/[ -]/g, '');
  if (!/^\d{13,19}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;

  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
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
