import type {
  CompiledPrivacyPolicy,
  MaskAttributeFn,
  MaskTextFn,
  PrivacyPolicy,
} from './types';
import { untaintedTagName } from '@rrweb/utils';

// Migration compatibility for other tools' mask/exclude class conventions
// (rrweb, Mixpanel, Amplitude, PostHog, Sentry, FullStory, Datadog, New
// Relic); `data-privacy` is the primary convention. Foreign mask/block
// tokens are protective-only. See guide.md's "Vendor class recognition"
// section for sourcing.
const VENDOR_MASK_CLASSES =
  '.rr-mask,.mp-mask,.fs-mask,.amp-mask,.ph-mask,.sentry-mask,[data-sentry-mask],.dd-privacy-mask,[data-dd-privacy="mask"],.dd-privacy-mask-user-input,[data-dd-privacy="mask-user-input"],.nr-mask,[data-nr-mask]';
// Never a foreign token: it may have been safe only under its own recorder's
// defaults, so migration compatibility must not grant it authority here.
const RRWEB_UNMASK_CLASS = '.rr-unmask';
const VENDOR_BLOCK_CLASSES =
  '.rr-block,.mp-block,.fs-exclude,.amp-block,.ph-no-capture,.sentry-block,.dd-privacy-hidden,[data-dd-privacy="hidden"],.nr-block,[data-nr-block]';
const PRIVACY_PRESETS = new Set(['strict', 'balanced', 'legacy']);
const MASKED_ATTRIBUTE_DEFAULTS = ['title', 'placeholder', 'aria-label'];

/**
 * CSS carried as an attribute. Masking these corrupts the replay without
 * protecting anything, so no branch of `finalizeAttribute` may touch them.
 */
const CSS_ATTRIBUTES = new Set(['style', '_csstext']);

/**
 * The only names `isGenerated` may exempt from masking -- the flag alone is a
 * single point of failure, so both it and this allowlist must agree.
 * Deliberately excludes `rr_dataURL`/`rr_src`: real page pixels and a URL.
 */
const RENDERING_METADATA_ATTRIBUTES = new Set([
  'rr_width',
  'rr_height',
  'rr_scrollleft',
  'rr_scrolltop',
  'rr_mediastate',
  'rr_open_mode',
]);

/**
 * rrweb's own operational attributes, present on the page rather than
 * serializer-written, so `isGenerated` can't vouch for them -- exempt from
 * every masking branch or coarse masking would erase the recorder's own
 * signals (e.g. star `data-privacy="mask"` itself, or break replay-side
 * password re-detection on `data-rr-is-password`). Keep this narrow: an
 * exemption is unconditional, so a wrong entry leaks verbatim.
 */
const OPERATIONAL_ATTRIBUTES = new Set([
  // The vendor-neutral privacy declaration the compiled policy matches on.
  'data-privacy',
  // Set by the mutation observer when it sees an input turn into a password
  // field, and read back by `getInputType` to keep masking it afterwards.
  'data-rr-is-password',
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

/**
 * Blocked media sources that can be swapped for a same-size placeholder rather
 * than dropped, keyed by the tag the placeholder is meaningful on. Only an
 * `<img>` source and a `<video>` poster resolve to a raster the browser lays
 * out at the element's declared size; an `<iframe>`/`<embed>`/`<object>` source
 * or `<audio>` source does not, and a `<source>` is a candidate its parent
 * picks from, so those keep being dropped outright.
 */
const MEDIA_PLACEHOLDER_ATTRIBUTES = new Map([
  ['IMG', new Set(['src', 'srcset', 'poster'])],
  ['VIDEO', new Set(['poster'])],
]);

/** A `width`/`height` content attribute we are willing to trust: plain pixels. */
const DIMENSION_ATTRIBUTE = /^\d{1,5}$/;

export const FORM_VALUE_TAGS = new Set([
  'INPUT',
  'OPTION',
  'SELECT',
  'TEXTAREA',
]);

/**
 * How a masked *text* value is occluded: every non-whitespace character
 * becomes a star, so the shape of the layout survives while the content does
 * not. (Attribute and input values use `stars`, which occludes to length.)
 */
function starText(value: string): string {
  return value.replace(/[\S]/g, '*');
}

/**
 * The single decision point for the text content rrweb records, on both the
 * snapshot and the mutation path: CSS is never masked, on any path, then the
 * mask decision the caller already took (`needsMask`) applies `maskTextFn`
 * if configured, or stars.
 *
 * @param exemptScript the snapshot path exempts `<script>` from the mask
 * branch, the mutation path does not -- pass explicitly, don't unify.
 */
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

/**
 * Whether real pixels may be recorded for `element`'s content: `strict`
 * blocks media wholesale, and a configured canvas masking provider means only
 * the FPS capture path can redact, so `toDataURL` must not run alongside it.
 */
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

/**
 * Split a selector list on top-level commas only -- not `split(',')`, which
 * mishandles `:is(a,b)`, `[data-x="a,b"]`, and an escaped `.a\,b`.
 * @internal exported for direct unit testing; not part of the privacy API.
 */
export function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    // Must come first: a backslash escapes anywhere, not just inside quotes,
    // or `.a\,b` tears in two and the stray `b` silently swallows another rule.
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

/**
 * Validates each selector as a whole (drops and warns on a broken one), then
 * merges the survivors into one deduplicated list. Dedup makes this
 * idempotent, which it must be: `record()` and `snapshot()` both merge the
 * same policy's selectors, so a `Set` is what keeps the second pass from
 * repeating every fragment.
 */
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
  const effective: PrivacyPolicy = policy || { version: 1, preset: 'legacy' };
  if (effective.version !== 1)
    throw new Error(
      `Unsupported Privacy at Capture policy version: ${String(
        effective.version,
      )}`,
    );
  if (!PRIVACY_PRESETS.has(effective.preset))
    throw new Error(`Unsupported privacy preset: ${String(effective.preset)}`);
  const preset = effective.preset;
  const nonLegacy = preset !== 'legacy';
  const maskedAttributes = new Set(nonLegacy ? MASKED_ATTRIBUTE_DEFAULTS : []);
  const blockMedia = preset === 'strict';

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
    maskTextSelector: nonLegacy
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
      nonLegacy
        ? ['[data-privacy="allow"]', RRWEB_UNMASK_CLASS, ...bySelector.unmask]
        : bySelector.unmask,
    ),
    blockSelector: joinSelectors(
      nonLegacy
        ? [
            '[data-privacy="exclude"]',
            VENDOR_BLOCK_CLASSES,
            ...bySelector.exclude,
          ]
        : bySelector.exclude.length
        ? ['[data-privacy="exclude"]', ...bySelector.exclude]
        : [],
    ),
    maskAllInputs: nonLegacy,
    maskedAttributes,
    // Spelled out from the branches of `finalizeAttribute`'s policy block
    // rather than from `preset` directly, so a new branch that forgets to
    // narrow this is a visible omission rather than a silent leak. The
    // strict-only `value` branch needs no clause of its own: `blockMedia` is
    // the `strict` alias, so `!blockMedia` has already excluded it.
    attributePolicyInert: !blockMedia && maskedAttributes.size === 0,
    blockMedia,
  };
}

/**
 * `record()`-level selector options go through the same validate-drop-warn
 * path as policy rule selectors, so a syntactically broken one can't reach
 * the runtime catch-to-mask and star the whole page off one typo.
 */
export function mergeSelectors(
  legacySelector: string | null | undefined,
  compiledSelector: string | null | undefined,
): string | null {
  return joinSelectors([legacySelector, compiledSelector]);
}

/** The privacy state one recording pass (or one `snapshot()` call) runs on. */
export type PrivacyContext = {
  privacy: CompiledPrivacyPolicy;
  blockSelector: string | null;
  maskTextSelector: string | null;
  unmaskTextSelector: string | null;
};

/**
 * The one privacy prologue: compile the policy, merge every `record()`-level
 * selector option with its compiled counterpart, and write the merged unmask
 * selector back onto the policy so `finalizeAttribute` (which reads it from
 * there) also honors a `record()`-level `unmaskTextSelector`.
 */
export function resolvePrivacyContext({
  privacy: compiled,
  privacyPolicy,
  blockSelector = null,
  maskTextSelector = null,
  unmaskTextSelector = null,
}: {
  /** An already-compiled policy; takes precedence over `privacyPolicy`. */
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

/**
 * How a masked *value* is occluded: replaced by as many stars as it had
 * characters, so its length -- and nothing else -- survives. (Text nodes use
 * `starText`, which preserves whitespace so the layout survives too.)
 */
export function stars(value: string): string {
  return '*'.repeat(value.length);
}

/**
 * Whether `element` sits inside an unmask subtree. A selector that throws
 * grants no escape: the caller stays on its masking path (fail closed).
 */
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

/**
 * One element's `isUnmasked` answer, reused across that element's whole
 * attribute sweep. An element with three masked attributes asked `closest()`
 * three times; the ancestor chain cannot change in between.
 */
type UnmaskMemo = { element: Element | null; answer: boolean };

/**
 * A neutral, same-dimension SVG standing in for a blocked image source, so
 * removing the pixels doesn't collapse the surrounding layout. Only `<`, `>`
 * and `#` are percent-encoded; the rest is already legal in a data URI.
 */
const URI_UNSAFE = /[<>#]/g;
const URI_ESCAPES: Record<string, string> = {
  '<': '%3C',
  '>': '%3E',
  '#': '%23',
};
/** Memoised on `WxH`; bounded like every other cache here. */
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

/**
 * Declared `width`/`height` content attributes only -- never
 * `getBoundingClientRect`, which would force a layout flush per attribute on
 * this hot path. Anything not plain integer pixels is rejected, not guessed.
 */
function declaredDimensions(element: Element): [string, string] | null {
  try {
    const width = element.getAttribute('width');
    const height = element.getAttribute('height');
    if (width === null || height === null) return null;
    if (!DIMENSION_ATTRIBUTE.test(width) || !DIMENSION_ATTRIBUTE.test(height))
      return null;
    return [width, height];
  } catch {
    return null;
  }
}

/**
 * What a blocked media source becomes: a same-size placeholder where one is
 * both meaningful and derivable without forcing layout, and `null` -- the
 * attribute dropped entirely -- everywhere else, which is the original and
 * still the fallback behaviour.
 */
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

/**
 * The single decision point for every attribute rrweb records, called once
 * per attribute at the end of serialization. Order matters:
 *  1. rendering metadata (`isGenerated` + `RENDERING_METADATA_ATTRIBUTES`),
 *     then 1b. `OPERATIONAL_ATTRIBUTES` -- rrweb's own signals, exempt before
 *     coarse masking can destroy them. Both return early.
 *  2. `maskAllElementAttributes` -- coarse kill switch, wins over
 *     `maskAttributeFn` (warned once). Returns early.
 *  3. `maskAttributeFn` -- try/catch, fails closed to stars; not an escape
 *     hatch, its output feeds (4).
 *  4. the compiled policy, final authority: media drop/placeholder, then the
 *     unmask escape (so it can't reopen it), then strict's form-value stars.
 *     Identity under `legacy`.
 * `style`/`_cssText` are exempt from every branch: CSS is never masked.
 */
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
  // Hot path: with no callback, no coarse switch, and a policy that has
  // nothing to say about attributes, this is the identity function. Bail
  // before lowercasing the name or touching the element.
  if (
    !maskAllElementAttributes &&
    !maskAttributeFn &&
    (!privacy || privacy.attributePolicyInert)
  )
    return value;
  if (value === null || value === '') return value;

  const normalizedName = name.toLowerCase();
  // Two gates, not one: the serializer must have written this value AND the
  // name must be known rendering metadata. Either alone is not enough.
  if (isGenerated && RENDERING_METADATA_ATTRIBUTES.has(normalizedName))
    return value;
  // No flag to pair with here: these are page-present attributes, exempted on
  // the name alone because rrweb's own operation depends on reading them back.
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
      // A callback that returns a non-string fails closed rather than putting
      // whatever it produced into the recording.
      current = typeof masked === 'string' ? masked : stars(value);
    } catch {
      return stars(value);
    }
  }

  if (!privacy) return current;

  // `untaintedTagName` is only read by the two branches that need it, not up
  // front for every attribute of every element.
  if (privacy.blockMedia && MEDIA_SOURCE_ATTRIBUTES.has(normalizedName)) {
    const tagName = untaintedTagName(element);
    if (MEDIA_TAGS.has(tagName))
      return blockedMediaValue(element, tagName, normalizedName);
  }
  if (privacy.maskedAttributes.has(normalizedName)) {
    // Unmask escapes only the masked-attribute default, never the media
    // branch above it.
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

/**
 * Runs every attribute through `finalizeAttribute` once, in place, after
 * serialization. Non-string, non-null values (e.g. `rr_scrollTop`) are
 * rrweb's own and skip the sweep.
 */
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
