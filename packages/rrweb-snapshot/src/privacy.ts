import type {
  CompiledDetector,
  CompiledPrivacyPolicy,
  MaskAttributeFn,
  MaskTextFn,
  PrivacyDetectorOptions,
  PrivacyPolicy,
} from './types';
import { untaintedTagName } from '@rrweb/utils';

// Migration compatibility with other tools' mask/exclude conventions;
// data-privacy leads. See guide.md's "Vendor class recognition" section.
const VENDOR_MASK_CLASSES =
  '.rr-mask,.mp-mask,.fs-mask,.amp-mask,.ph-mask,.sentry-mask,[data-sentry-mask],.dd-privacy-mask,[data-dd-privacy="mask"],.dd-privacy-mask-user-input,[data-dd-privacy="mask-user-input"],.nr-mask,[data-nr-mask]';
const RRWEB_UNMASK_CLASS = '.rr-unmask';
const VENDOR_BLOCK_CLASSES =
  '.rr-block,.mp-block,.fs-exclude,.amp-block,.ph-no-capture,.sentry-block,.dd-privacy-hidden,[data-dd-privacy="hidden"],.nr-block,[data-nr-block]';
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
  const base: PrivacyPolicy = policy || { version: 1, preset: 'manual' };
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
  const detectors = buildDetectors(effective.detectors);
  const maskAllInputs = managed || detectors.length > 0;
  const maskedAttributes = new Set(managed ? MASKED_ATTRIBUTE_DEFAULTS : []);
  const blockMedia = preset === 'strict';
  const sanitizeUrls = managed;

  const bySelector = {
    mask: [] as string[],
    unmask: [] as string[],
    exclude: [] as string[],
  };
  for (const rule of effective.rules || []) {
    if (
      !rule.target ||
      rule.target.type !== 'selector' ||
      !rule.target.selector
    )
      throw new Error('Privacy rules require a non-empty selector target');
    const action = rule.action === 'allow' ? 'unmask' : rule.action;
    if (!(action in bySelector))
      throw new Error(`Unsupported privacy action: ${String(rule.action)}`);
    bySelector[action].push(rule.target.selector);
  }

  return {
    preset,
    maskTextSelector: managed
      ? preset === 'strict'
        ? '*'
        : joinSelectors([
            '[data-privacy="mask"]',
            VENDOR_MASK_CLASSES,
            ...bySelector.mask,
          ])
      : joinSelectors(
          bySelector.mask.length
            ? ['[data-privacy="mask"]', ...bySelector.mask]
            : [],
        ),
    unmaskTextSelector: joinSelectors(
      managed
        ? ['[data-privacy="allow"]', RRWEB_UNMASK_CLASS, ...bySelector.unmask]
        : bySelector.unmask,
    ),
    blockSelector: joinSelectors(
      managed
        ? [
            '[data-privacy="exclude"]',
            VENDOR_BLOCK_CLASSES,
            ...bySelector.exclude,
          ]
        : bySelector.exclude.length
        ? ['[data-privacy="exclude"]', ...bySelector.exclude]
        : [],
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

export function sanitizeUrl(
  value: string,
  privacy: CompiledPrivacyPolicy | undefined,
): string | null {
  if (!value) return value;
  if (!privacy || !privacy.sanitizeUrls) return value;
  try {
    const url = new URL(value, 'https://rrweb.invalid');
    url.username = '';
    url.password = '';
    for (const [name] of url.searchParams) {
      const lower = name.toLowerCase();
      if (
        (privacy.preset === 'strict' && !privacy.allowedQueryParameters) ||
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
