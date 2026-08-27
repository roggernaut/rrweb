import type {
  CompiledPrivacyPolicy,
  MaskAttributeFn,
  MaskTextFn,
  PrivacyPolicy,
} from './types';
import { untaintedTagName } from '@rrweb/utils';

// `data-privacy` is the primary, vendor-neutral convention for declaring
// privacy intent; the class lists below are migration compatibility for pages
// already instrumented for another tool.
//
// These are the mask/exclude conventions of major session-replay tools
// (rrweb, Mixpanel, Amplitude, PostHog, Sentry, FullStory, Datadog, New
// Relic) that pages may already carry. Recognizing a foreign mask/block
// token is protective-only -- it can only increase masking. Foreign
// UNMASK/allow tokens are deliberately never honored (they could reveal); see
// `VENDOR_UNMASK_CLASSES` below.
//
// Sources:
// - Datadog `browser-sdk packages/browser-rum-core/src/domain/privacyConstants.ts`
//   (`data-dd-privacy` attr; `dd-privacy-` class prefix; `mask`/
//   `mask-user-input`/`hidden` values; `allow` and `mask-unless-allowlisted`
//   deliberately excluded)
// - New Relic `newrelic-browser-agent src/common/config/init.js`
//   (`[data-nr-mask]`, `nr-mask`, `nr-block`, `[data-nr-block]`; `nr-unmask`/
//   `nr-ignore` deliberately excluded)
const VENDOR_MASK_CLASSES =
  '.rr-mask,.mp-mask,.fs-mask,.amp-mask,.ph-mask,.sentry-mask,[data-sentry-mask],.dd-privacy-mask,[data-dd-privacy="mask"],.dd-privacy-mask-user-input,[data-dd-privacy="mask-user-input"],.nr-mask,[data-nr-mask]';
// Amplitude is the only vendor that ships an unmask class (`.amp-unmask`);
// Sentry's `unmask` default is `[]`, so there is no `.sentry-unmask` to be
// compatible with. `.rr-unmask` is rrweb's own convention, not vendor compat.
const VENDOR_UNMASK_CLASSES = '.rr-unmask,.amp-unmask';
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
 * The only attribute names the serializer's `isGenerated` flag may exempt from
 * masking. The flag says "rrweb wrote this value", but a flag alone is a
 * single point of failure: a mis-set flag on a page-authored attribute would
 * leak it verbatim. PostHog gates the same exemption on a fixed name
 * allowlist, so both must agree.
 *
 * Deliberately excluded: `rr_dataURL` and `rr_src`, whose values are real page
 * pixels and a real page URL respectively.
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
 * Attributes that are part of rrweb's own operation rather than page content,
 * and are therefore exempt from every masking branch. This is the sibling of
 * `RENDERING_METADATA_ATTRIBUTES` above for attributes that are *present on the
 * page* rather than written by the serializer, so the `isGenerated` flag can
 * never vouch for them -- the name alone has to.
 *
 * Coarse masking must not be able to destroy the recorder's own signals:
 * `maskAllElementAttributes` starring `data-privacy="mask"` into `**********`
 * would erase, from the recording, the very declaration that explains why the
 * subtree around it is masked; starring `data-rr-is-password` would break the
 * password re-detection `getInputType` performs on the replay side.
 *
 * Datadog carves out the same class of attribute for the same reason:
 * `shouldMaskAttribute` (browser-sdk
 * `packages/browser-rum-core/src/domain/privacy.ts:166-172`) returns `false`
 * for its own `data-dd-privacy`, for `STABLE_ATTRIBUTES`, and for the
 * configured `actionNameAttribute` before any masking rule is consulted.
 *
 * Deliberately narrow: only rrweb-namespaced names the recorder or replayer
 * actually depends on. Nothing page-authored and potentially sensitive belongs
 * here -- an exemption is unconditional, so a wrong entry leaks verbatim. A
 * reserved-but-unread name does not qualify: if no code path reads it, masking
 * it breaks nothing and exempting it only widens the hole.
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
 * snapshot and the mutation path. It owns the whole ladder:
 *
 *  1. CSS is never masked, on any path -- a starred stylesheet corrupts the
 *     replay and reveals nothing.
 *  2. the mask decision the caller already took (`needsMask`) -- `maskTextFn`
 *     if one is configured, stars otherwise.
 *
 * @param exemptScript preserves an inherited asymmetry: the snapshot path
 * exempts `<script>` text from the mask branch, the mutation path does not.
 * Passing it explicitly keeps the two callers honest about the difference
 * instead of unifying it silently; unifying is a behavior change and is
 * deliberately left for upstream review.
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
  /**
   * The text node's parent element -- the source of the STYLE/SCRIPT
   * exemptions, and the element handed to `maskTextFn`.
   */
  parent: HTMLElement | null;
  /**
   * `untaintedTagName(parent)`, when the caller has already computed it. Both
   * call sites sit on the serializer's hot path, so the read is not repeated.
   */
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
 * Whether real pixels may be recorded for `element`'s content.
 *
 * Two independent reasons to say no, folded into one call so both snapshot
 * pixel sites ask the same question the same way:
 *  - `strict` blocks media wholesale (`blockMedia` is the preset alias);
 *  - a configured canvas masking provider means the only capture path that
 *    can redact anything is the FPS one, so the snapshot's own `toDataURL`
 *    must not run alongside it.
 *
 * The second reason is a canvas concern only, so the `<img>` inlining site
 * passes no thunk.
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
 * Split a selector list on its *top-level* commas only, so that merging and
 * deduplicating lists never rewrites what a fragment means.
 *
 * The three things a naive `split(',')` gets wrong, all of which round-trip
 * through `joinSelectors`:
 *  - `:is(a,b)` / `:not(a,b)` -- commas nested in a functional pseudo-class
 *  - `[data-x="a,b"]` -- commas inside an attribute value string
 *  - `.a\,b` -- an *escaped* comma, which is a literal character in the class
 *    name (this selector matches `class="a,b"`), not a separator
 *
 * @internal exported for direct unit testing; not part of the privacy API.
 */
export function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    // A backslash escapes the next character *anywhere* in a selector, inside
    // a quoted string or not. Handling it only inside quotes would tear
    // `.a\,b` in two, and the stray `b` fragment would then collide in the
    // dedupe with an unrelated `b` selector and silently swallow it -- a
    // dropped mask selector is a fail-open, so this case must come first.
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
 * Validates each incoming selector as a whole (a list containing one broken
 * compound is dropped entirely, warning as it goes), then merges the surviving
 * lists into one deduplicated list.
 *
 * Deduplication is what makes this idempotent, and it has to be:
 * `record()` merges the policy's selectors into the options it hands to
 * `snapshot()`, which compiles the same policy again and merges a second
 * time. Without a `Set` every fragment would be repeated on each pass.
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
        ? [
            '[data-privacy="allow"]',
            VENDOR_UNMASK_CLASSES,
            ...bySelector.unmask,
          ]
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
 * The `record()`-level selector options go through the same `validateSelector`
 * drop-and-warn path as policy rule selectors. Merging an unvalidated selector
 * would make every later `matches()` call throw, and the runtime catch-to-mask
 * would then star the whole page off one typo. That catch stays as the
 * backstop for a selector that validates but throws while matching; this just
 * stops a syntactically broken selector from ever reaching it. The compiled
 * halves are already validated, so re-probing them is only a cheap no-op.
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
 * The one privacy prologue: compile the portable policy (unless an
 * already-compiled one is handed in), merge every `record()`-level selector
 * option with its compiled counterpart, and write the merged unmask selector
 * back onto the policy.
 *
 * The write-back is what makes "one unmask selector, honored everywhere" true.
 * `finalizeAttribute` reads the *compiled policy's* `unmaskTextSelector`, so
 * without it the `record()`-level string option would only ever affect text
 * masking and would silently skip the masked-attribute escape.
 *
 * Both `record()` and a standalone `snapshot()` call go through here, which is
 * why merging has to be idempotent -- see `joinSelectors`.
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
 * A neutral, same-dimension SVG to stand in for a blocked image source, so
 * that removing the pixels does not also collapse the layout that surrounded
 * them. Datadog ships the same idea (`censoredImageForSize`, browser-sdk
 * `packages/browser-rum/src/domain/record/serialization/serializationUtils.ts`),
 * which serves a flat silver rectangle at the image's size.
 *
 * Only `<`, `>` and `#` are percent-encoded -- the rest is already legal in a
 * data URI, and leaving it readable keeps recorded values diffable.
 */
const URI_UNSAFE = /[<>#]/g;
const URI_ESCAPES: Record<string, string> = {
  '<': '%3C',
  '>': '%3E',
  '#': '%23',
};
/**
 * A blocked page usually repeats a handful of image sizes, so the encoded
 * string is memoised on `WxH`. Bounded like every other cache here: a page
 * with unbounded distinct dimensions stops caching rather than growing.
 */
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
 * The element's *declared* dimensions, read from the `width`/`height` content
 * attributes and nothing else.
 *
 * Deliberately not `getBoundingClientRect` (which is what Datadog falls back
 * to): `finalizeAttribute` runs once per attribute on the serializer's hot
 * path, so measuring there would trade a layout flush for every attribute of
 * every element. Attributes are free to read.
 *
 * Anything that is not plain integer pixels (`50%`, `auto`, `-1`, `1e9`) is
 * rejected rather than guessed at, and an element that declares no usable
 * dimensions gets no placeholder -- the attribute is dropped, as before.
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
 * The single decision point for every attribute rrweb records, on both the
 * snapshot and the mutation path. Called exactly once per attribute, at the
 * end of serialization, so no earlier stage needs to know about privacy.
 *
 * Decision order:
 *  1. `isGenerated` AND a name in `RENDERING_METADATA_ATTRIBUTES` -- the
 *     serializer wrote this value itself (rr_width, rr_scrollTop, ...), so it
 *     is safe by construction and never masked. Both gates are required: the
 *     flag alone would let a single mis-set call site leak a page attribute
 *     verbatim. `rr_dataURL` and `rr_src` are deliberately off the allowlist
 *     -- they hold real page pixels and a real page URL. Returns early.
 *  1b. a name in `OPERATIONAL_ATTRIBUTES` -- rrweb's own signals, which no
 *     masking branch may destroy. Sits above (2) and (3) on purpose: coarse
 *     masking is exactly what would otherwise erase them. Returns early.
 *  2. `maskAllElementAttributes` -- stars. It is the coarse kill switch and
 *     takes precedence over `maskAttributeFn`, which is then ignored with a
 *     one-time warning. Returns early.
 *  3. `maskAttributeFn` -- run in try/catch; a throwing callback fails closed
 *     to stars rather than leaking the raw value. Does NOT return early: this
 *     is a pipeline, not an escape hatch. Its output is the input to (4).
 *  4. the compiled policy, the final authority -- strict drops media sources
 *     (an `<img>` source or `<video>` poster whose element declares integer
 *     `width`/`height` attributes becomes a neutral same-size SVG instead, so
 *     the surrounding layout survives the drop),
 *     `privacy.maskedAttributes` are starred unless the element sits inside
 *     `privacy.unmaskTextSelector` (the unmask escape, which runs *after* the
 *     media-drop branch and so can never reopen it), and form `value`
 *     attributes are starred under strict. Under `legacy` this block is the identity, so a callback's
 *     output survives verbatim; under balanced/strict the policy applies on
 *     top of it and can only narrow what the callback chose to keep.
 *
 * `style`/`_cssText` are exempt from every branch: masked CSS breaks the
 * replay and reveals nothing.
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
    // An unmask ancestor is an explicit "this subtree is safe" statement and
    // escapes the preset's masked-attribute defaults, matching Sentry's
    // `maskAttribute` precedent. It cannot reach the branch above: a blocked
    // media source is still dropped.
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
 * The one finalization sweep, shared by `serializeElementNode` and the
 * mutation buffer's attribute emit: every attribute rrweb is about to record
 * passes through `finalizeAttribute` exactly once, in place, after every
 * other serialization stage has had its say.
 *
 * Non-string, non-null values (a number like `rr_scrollTop`, or `true` on a
 * checked radio) are rrweb's own and skip the sweep.
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
