import type {
  CompiledPrivacyPolicy,
  PrivacyAction,
  PrivacyDetectorOptions,
  PrivacyPolicy,
  SensitiveDataKind,
  MaskAttributeFn,
} from './types';

const ACTION_PRIORITY: Record<PrivacyAction, number> = {
  allow: 0,
  mask: 1,
  exclude: 2,
};

const DATA_PRIVACY_RULES: CompiledPrivacyPolicy['rules'] = [
  {
    action: 'allow',
    selector: '[data-privacy="allow"]',
  },
  {
    action: 'mask',
    selector: '[data-privacy="mask"]',
  },
  {
    action: 'exclude',
    selector: '[data-privacy="exclude"]',
  },
];

const PRIVACY_PRESETS = new Set(['strict', 'balanced', 'custom', 'legacy']);
const MASK_STYLES = new Set([
  'replacement',
  'solid',
  'blur',
  'pixelate',
  'shuffle',
]);

const SENSITIVE_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'placeholder',
  'title',
]);

const URL_ATTRIBUTES = new Set([
  'action',
  'background',
  'data',
  'formaction',
  'href',
  'poster',
  'src',
  'xlink:href',
]);

const MEDIA_SOURCE_ATTRIBUTES = new Set([
  'background',
  'data',
  'poster',
  'src',
  'srcset',
]);

const DEFAULT_DETECTORS: Required<Omit<PrivacyDetectorOptions, 'custom'>> = {
  email: true,
  phone: true,
  paymentCard: true,
  ssn: true,
  ipAddress: true,
};

const DETECTOR_SCAN_CHUNK_SIZE = 8_192;
const CUSTOM_DETECTOR_SCAN_CHUNK_SIZE = 512;
const MAX_DETECTOR_MATCHES = 1_000;
const MAX_CUSTOM_PATTERN_LENGTH = 256;
const MAX_CUSTOM_MATCH_LENGTH = 1_024;
const DEFAULT_CUSTOM_MATCH_LENGTH = 256;
const NON_CONTENT_TEXT_TAGS = new Set(['SCRIPT', 'STYLE']);

const PROTECTED_AUTOCOMPLETE = new Set([
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-name',
  'cc-number',
  'current-password',
  'new-password',
  'one-time-code',
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

const FORM_VALUE_TAGS = new Set(['INPUT', 'OPTION', 'SELECT', 'TEXTAREA']);

const MEDIA_TAGS = new Set([
  'AUDIO',
  'EMBED',
  'IFRAME',
  'IMG',
  'OBJECT',
  'SOURCE',
  'VIDEO',
]);

const SAFE_GENERATED_ATTRIBUTES = new Set([
  'rr_width',
  'rr_height',
  'rr_left',
  'rr_top',
  'rr_position',
  'rr_transform',
  'rr_display',
  'rr_scrollleft',
  'rr_scrolltop',
  'rr_mediastate',
  'rr_open_mode',
]);

export type SensitiveMatch = {
  start: number;
  end: number;
  kind: SensitiveDataKind;
  detector: string;
};

export function compilePrivacyPolicy(
  policy: PrivacyPolicy | undefined,
): CompiledPrivacyPolicy {
  const effectivePolicy: PrivacyPolicy = policy || {
    version: 1,
    preset: 'legacy',
  };
  if (effectivePolicy.version !== 1) {
    throw new Error(
      `Unsupported Privacy at Capture policy version: ${String(
        effectivePolicy.version,
      )}`,
    );
  }
  if (!PRIVACY_PRESETS.has(effectivePolicy.preset)) {
    throw new Error(
      `Unsupported privacy preset: ${String(effectivePolicy.preset)}`,
    );
  }

  const policyRules = (effectivePolicy.rules || []).map((rule) => {
    if (!rule.target || rule.target.type !== 'selector') {
      throw new Error(
        `Unsupported privacy target type: ${String(rule.target?.type)}`,
      );
    }
    if (!rule.target.selector)
      throw new Error('Privacy rule selector cannot be empty');
    if (!(rule.action in ACTION_PRIORITY)) {
      throw new Error(`Unsupported privacy action: ${String(rule.action)}`);
    }
    if (rule.style && !MASK_STYLES.has(rule.style)) {
      throw new Error(`Unsupported privacy mask style: ${String(rule.style)}`);
    }
    return {
      action: rule.action,
      style: rule.style,
      classification: rule.classification,
      selector: rule.target.selector,
      attributes: rule.target.attributes
        ? new Set(
            rule.target.attributes.map((attribute) => attribute.toLowerCase()),
          )
        : undefined,
    };
  });
  const rules = [...DATA_PRIVACY_RULES, ...policyRules];

  const detectorOptions = {
    ...(effectivePolicy.preset === 'balanced' ||
    effectivePolicy.preset === 'strict'
      ? DEFAULT_DETECTORS
      : {}),
    ...effectivePolicy.detectors,
  };
  const detectors: CompiledPrivacyPolicy['detectors'] = [];

  if (detectorOptions.email) {
    detectors.push({
      name: 'email',
      regex:
        /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63}){1,3}/g,
      classification: 'contact',
      minimumLength: 6,
      maximumMatchLength: 320,
      scanChunkSize: DETECTOR_SCAN_CHUNK_SIZE,
      validate: (candidate) => candidate.length <= 254,
    });
  }
  if (detectorOptions.phone) {
    detectors.push({
      name: 'phone',
      regex: /(?:\+?\d[\d ().-]{7,29}\d)/g,
      classification: 'contact',
      minimumLength: 10,
      maximumMatchLength: 32,
      scanChunkSize: DETECTOR_SCAN_CHUNK_SIZE,
      validate: (candidate) => {
        const length = candidate.replace(/\D/g, '').length;
        return length >= 10 && length <= 15;
      },
    });
  }
  if (detectorOptions.paymentCard) {
    detectors.push({
      name: 'payment-card',
      regex: /(?:\d[ -]?){12,18}\d/g,
      classification: 'payment',
      minimumLength: 13,
      maximumMatchLength: 37,
      scanChunkSize: DETECTOR_SCAN_CHUNK_SIZE,
      validate: passesLuhn,
    });
  }
  if (detectorOptions.ssn) {
    detectors.push({
      name: 'ssn',
      regex: /\b\d{3}-?\d{2}-?\d{4}\b/g,
      classification: 'identity',
      minimumLength: 9,
      maximumMatchLength: 11,
      scanChunkSize: DETECTOR_SCAN_CHUNK_SIZE,
    });
  }
  if (detectorOptions.ipAddress) {
    detectors.push({
      name: 'ip-address',
      regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      classification: 'location',
      minimumLength: 7,
      maximumMatchLength: 15,
      scanChunkSize: DETECTOR_SCAN_CHUNK_SIZE,
      validate: (candidate) =>
        candidate.split('.').every((part) => Number(part) <= 255),
    });
  }
  for (const detector of detectorOptions.custom || []) {
    const minimumLength = detector.minimumLength ?? 1;
    const maximumMatchLength =
      detector.maximumMatchLength ?? DEFAULT_CUSTOM_MATCH_LENGTH;
    validateCustomDetector(
      detector.name,
      detector.pattern,
      detector.flags,
      minimumLength,
      maximumMatchLength,
    );
    detectors.push({
      name: detector.name,
      regex: new RegExp(detector.pattern, ensureGlobalFlag(detector.flags)),
      classification: detector.classification || 'custom',
      minimumLength,
      maximumMatchLength,
      scanChunkSize: CUSTOM_DETECTOR_SCAN_CHUNK_SIZE,
    });
  }

  return {
    policy: effectivePolicy,
    rules,
    detectors,
    minimumDetectorLength:
      detectors.length > 0
        ? Math.min(...detectors.map((detector) => detector.minimumLength))
        : Number.POSITIVE_INFINITY,
    blockSelector:
      rules
        .filter((rule) => rule.action === 'exclude' && !rule.attributes)
        .map((rule) => rule.selector)
        .join(',') || null,
  };
}

export function mergeBlockSelectors(
  legacySelector: string | null,
  privacy: CompiledPrivacyPolicy | undefined,
): string | null {
  return (
    [legacySelector, privacy?.blockSelector].filter(Boolean).join(',') || null
  );
}

export function getPrivacyAction(
  element: Element | null,
  privacy: CompiledPrivacyPolicy | undefined,
  attribute?: string,
  requireExplicitAttribute = false,
): PrivacyAction | undefined {
  if (!element || !privacy) return undefined;

  let best:
    | { action: PrivacyAction; distance: number; priority: number }
    | undefined;
  let current: Element | null = element;
  let distance = 0;

  while (current) {
    for (const rule of privacy.rules) {
      if (requireExplicitAttribute && !rule.attributes) continue;
      if (
        attribute &&
        rule.attributes &&
        !rule.attributes.has(attribute.toLowerCase())
      ) {
        continue;
      }
      if (!attribute && rule.attributes) continue;

      let matches = false;
      try {
        matches = current.matches(rule.selector);
      } catch {
        continue;
      }
      if (!matches) continue;

      const priority = ACTION_PRIORITY[rule.action];
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance && priority > best.priority)
      ) {
        best = { action: rule.action, distance, priority };
      }
    }
    current = parentElementAcrossShadowRoot(current);
    distance += 1;
  }

  return best?.action;
}

export function maskTextWithPrivacy(
  value: string,
  element: HTMLElement | null,
  privacy: CompiledPrivacyPolicy | undefined,
  legacyMask: boolean,
  legacyMaskFn?: (text: string, element: HTMLElement | null) => string,
): string {
  if (!privacy) {
    return legacyMask ? applyLegacyMask(value, element, legacyMaskFn) : value;
  }

  if (element && NON_CONTENT_TEXT_TAGS.has(element.tagName)) {
    return element.tagName === 'SCRIPT' ? 'SCRIPT_PLACEHOLDER' : value;
  }

  const action = getPrivacyAction(element, privacy);
  if (privacy.policy.preset === 'legacy' && !action) {
    return legacyMask ? applyLegacyMask(value, element, legacyMaskFn) : value;
  }
  if (action === 'allow') return value;
  if (action === 'exclude') return '';
  if (action === 'mask' || privacy.policy.preset === 'strict') {
    return replacePreservingShape(value);
  }
  if (legacyMask) return applyLegacyMask(value, element, legacyMaskFn);
  if (privacy.detectors.length > 0) {
    return maskSensitiveRanges(value, detectSensitiveText(value, privacy));
  }
  return value;
}

export function shouldMaskInputWithPrivacy(
  element: HTMLElement,
  privacy: CompiledPrivacyPolicy | undefined,
  legacyMask: boolean,
): boolean {
  if (!privacy) return legacyMask;

  const action = getPrivacyAction(element, privacy);
  if (privacy.policy.preset === 'legacy' && !action) return legacyMask;
  if (isProtectedInput(element)) return true;
  if (action === 'mask') return true;
  if (action === 'exclude') return true;
  if (action === 'allow') return false;
  if (privacy.policy.preset === 'strict') return true;
  if (privacy.policy.preset === 'balanced') return true;
  return legacyMask;
}

export function maskInputWithPrivacy(
  value: string,
  element: HTMLElement,
  privacy: CompiledPrivacyPolicy | undefined,
  legacyMask: boolean,
  legacyMaskFn?: (text: string, element: HTMLElement) => string,
): string {
  if (!shouldMaskInputWithPrivacy(element, privacy, legacyMask)) return value;
  const action = getPrivacyAction(element, privacy);
  if (!privacy || (privacy.policy.preset === 'legacy' && !action)) {
    return legacyMaskFn
      ? legacyMaskFn(value, element)
      : '*'.repeat(value.length);
  }
  return replacePreservingShape(value);
}

export function maskAttributeWithPrivacy(
  element: HTMLElement,
  name: string,
  value: string | null,
  privacy: CompiledPrivacyPolicy | undefined,
): string | null {
  if (!value || !privacy) return value;

  const normalizedName = name.toLowerCase();
  const standardSensitiveAttribute =
    normalizedName === 'value' ||
    SENSITIVE_ATTRIBUTES.has(normalizedName) ||
    URL_ATTRIBUTES.has(normalizedName);
  const action = getPrivacyAction(
    element,
    privacy,
    normalizedName,
    !standardSensitiveAttribute,
  );
  if (privacy.policy.preset === 'legacy' && !action) return value;
  if (normalizedName === 'value' && isProtectedInput(element)) {
    return replacePreservingShape(value);
  }
  if (action === 'allow') return value;
  if (action === 'exclude') return null;
  if (action === 'mask') return replacePreservingShape(value);
  if (
    privacy.policy.preset === 'strict' &&
    normalizedName === 'value' &&
    FORM_VALUE_TAGS.has(element.tagName)
  ) {
    return replacePreservingShape(value);
  }

  if (
    privacy.policy.preset === 'strict' &&
    MEDIA_TAGS.has(element.tagName) &&
    MEDIA_SOURCE_ATTRIBUTES.has(normalizedName)
  ) {
    return null;
  }
  if (URL_ATTRIBUTES.has(normalizedName)) {
    return sanitizeUrl(value, privacy);
  }
  if (SENSITIVE_ATTRIBUTES.has(normalizedName)) {
    return privacy.policy.preset === 'strict'
      ? replacePreservingShape(value)
      : maskSensitiveRanges(value, detectSensitiveText(value, privacy));
  }
  return value;
}

/**
 * Apply runtime attribute escape hatches without allowing them to undo the
 * portable policy. The coarse mode wins over the callback, and the policy is
 * always the final authority.
 */
export function protectSerializedAttribute({
  element,
  name,
  value,
  privacy,
  maskAllElementAttributes = false,
  maskAttributeFn,
  isGenerated = false,
}: {
  element: Element;
  name: string;
  value: string | null;
  privacy: CompiledPrivacyPolicy | undefined;
  maskAllElementAttributes?: boolean;
  maskAttributeFn?: MaskAttributeFn;
  isGenerated?: boolean;
}): string | null {
  if (!value) return value;

  let protectedValue = value;
  if (maskAllElementAttributes) {
    protectedValue =
      isGenerated && SAFE_GENERATED_ATTRIBUTES.has(name.toLowerCase())
        ? value
        : '*'.repeat(value.length);
  } else if (maskAttributeFn) {
    try {
      protectedValue = maskAttributeFn(name, value, element);
    } catch {
      // A masking callback is part of the privacy boundary; failure must not
      // silently publish the original value.
      protectedValue = '*'.repeat(value.length);
    }
  }

  return maskAttributeWithPrivacy(
    element as HTMLElement,
    name,
    protectedValue,
    privacy,
  );
}

export function sanitizeUrl(
  value: string,
  privacy: CompiledPrivacyPolicy | undefined,
): string {
  if (!privacy || privacy.policy.preset === 'legacy') return value;
  try {
    const url = new URL(value, 'https://rrweb.invalid');
    const allowed = privacy.policy.url?.allowedQueryParameters?.map((name) =>
      name.toLowerCase(),
    );
    const blocked = new Set(
      [
        ...DEFAULT_BLOCKED_QUERY_PARAMETERS,
        ...(privacy.policy.url?.blockedQueryParameters || []),
      ].map((name) => name.toLowerCase()),
    );

    for (const [name, parameterValue] of url.searchParams) {
      if (
        (privacy.policy.preset === 'strict' && !allowed) ||
        (allowed && !allowed.includes(name.toLowerCase())) ||
        blocked.has(name.toLowerCase()) ||
        detectSensitiveText(parameterValue, privacy).length > 0
      ) {
        url.searchParams.set(name, '*');
      }
    }
    url.pathname = maskSensitiveRanges(
      url.pathname,
      detectSensitiveText(url.pathname, privacy),
    );
    if (privacy.policy.url?.removeHash !== false) url.hash = '';

    if (url.origin === 'https://rrweb.invalid') {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return maskSensitiveRanges(value, detectSensitiveText(value, privacy));
  }
}

export function detectSensitiveText(
  value: string,
  privacy: CompiledPrivacyPolicy,
): SensitiveMatch[] {
  if (
    privacy.detectors.length === 0 ||
    value.length < privacy.minimumDetectorLength
  ) {
    return [];
  }

  const matches: SensitiveMatch[] = [];
  for (const detector of privacy.detectors) {
    if (value.length < detector.minimumLength) continue;

    for (
      let offset = 0;
      offset < value.length;
      offset += detector.scanChunkSize
    ) {
      const primaryEnd = Math.min(
        offset + detector.scanChunkSize,
        value.length,
      );
      const scanEnd = Math.min(
        primaryEnd + detector.maximumMatchLength - 1,
        value.length,
      );
      const chunk = value.slice(offset, scanEnd);
      detector.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = detector.regex.exec(chunk))) {
        const start = offset + match.index;
        if (start >= primaryEnd) break;
        if (match[0].length > detector.maximumMatchLength) {
          matches.push({
            start: 0,
            end: value.length,
            kind: detector.classification,
            detector: `${detector.name}:oversize`,
          });
          return mergeMatches(matches);
        }
        if (!detector.validate || detector.validate(match[0])) {
          matches.push({
            start,
            end: start + match[0].length,
            kind: detector.classification,
            detector: detector.name,
          });
          if (matches.length >= MAX_DETECTOR_MATCHES) {
            // Detection is a privacy boundary. If a hostile value produces an
            // unreasonable number of matches, mask the complete value because
            // later detectors have not necessarily scanned its prefix.
            matches.push({
              start: 0,
              end: value.length,
              kind: detector.classification,
              detector: `${detector.name}:overflow`,
            });
            return mergeMatches(matches);
          }
        }
        if (match[0].length === 0) detector.regex.lastIndex += 1;
      }
    }
  }
  return mergeMatches(matches);
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

export function replacePreservingShape(value: string): string {
  return value.replace(/[\p{L}\p{N}]/gu, (character) =>
    /\p{N}/u.test(character) ? '0' : 'x',
  );
}

function isProtectedInput(element: HTMLElement): boolean {
  if (element.tagName !== 'INPUT') return false;
  const input = element as HTMLInputElement;
  if (
    input.type === 'password' ||
    input.type === 'hidden' ||
    input.hasAttribute('data-rr-is-password')
  ) {
    return true;
  }
  return input.autocomplete
    .toLowerCase()
    .split(/\s+/)
    .some((token) => PROTECTED_AUTOCOMPLETE.has(token));
}

function validateCustomDetector(
  name: string,
  pattern: string,
  flags: string | undefined,
  minimumLength: number,
  maximumMatchLength: number,
): void {
  const label = name || '<unnamed>';
  if (!name.trim()) throw new Error('Custom detector name cannot be empty');
  if (!pattern || pattern.length > MAX_CUSTOM_PATTERN_LENGTH) {
    throw new Error(
      `Custom detector "${label}" pattern must be 1-${MAX_CUSTOM_PATTERN_LENGTH} characters`,
    );
  }
  if (
    !Number.isInteger(minimumLength) ||
    minimumLength < 1 ||
    minimumLength > MAX_CUSTOM_MATCH_LENGTH
  ) {
    throw new Error(
      `Custom detector "${label}" minimumLength must be an integer from 1-${MAX_CUSTOM_MATCH_LENGTH}`,
    );
  }
  if (
    !Number.isInteger(maximumMatchLength) ||
    maximumMatchLength < 1 ||
    maximumMatchLength > MAX_CUSTOM_MATCH_LENGTH
  ) {
    throw new Error(
      `Custom detector "${label}" maximumMatchLength must be an integer from 1-${MAX_CUSTOM_MATCH_LENGTH}`,
    );
  }
  if (
    flags &&
    (!/^[dgimsuv]*$/.test(flags) || new Set(flags).size !== flags.length)
  ) {
    throw new Error(`Custom detector "${label}" has unsupported regex flags`);
  }
  if (/\\[1-9]/.test(pattern) || /\(\?<([=!])/.test(pattern)) {
    throw new Error(
      `Custom detector "${label}" cannot use backreferences or lookbehind`,
    );
  }
  if (hasUnsafeNestedRepetition(pattern)) {
    throw new Error(
      `Custom detector "${label}" contains ambiguous nested repetition`,
    );
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, ensureGlobalFlag(flags));
  } catch {
    throw new Error(`Custom detector "${label}" contains an invalid regex`);
  }
  regex.lastIndex = 0;
  if (regex.test('')) {
    throw new Error(`Custom detector "${label}" cannot match empty text`);
  }
}

function hasUnsafeNestedRepetition(pattern: string): boolean {
  const groups: Array<{ repeated: boolean; alternation: boolean }> = [];
  let inCharacterClass = false;
  let escaped = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '[') {
      inCharacterClass = true;
      continue;
    }
    if (character === ']' && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass) continue;

    if (character === '(') {
      groups.push({ repeated: false, alternation: false });
      continue;
    }
    if (character === '|') {
      const group = groups[groups.length - 1];
      if (group) group.alternation = true;
      continue;
    }
    if (character === '*' || character === '+') {
      const group = groups[groups.length - 1];
      if (group) group.repeated = true;
      continue;
    }
    if (character === '{') {
      const repetition = pattern.slice(index).match(/^\{\d+,\}/);
      if (repetition) {
        const group = groups[groups.length - 1];
        if (group) group.repeated = true;
      }
      continue;
    }
    if (character !== ')') continue;

    const group = groups.pop();
    if (!group) continue;
    const following = pattern.slice(index + 1);
    const unboundedOuterRepeat =
      following.startsWith('*') ||
      following.startsWith('+') ||
      /^\{\d+,\}/.test(following);
    if (unboundedOuterRepeat && (group.repeated || group.alternation)) {
      return true;
    }
    const parent = groups[groups.length - 1];
    if (parent && group.repeated) parent.repeated = true;
    if (unboundedOuterRepeat) {
      if (parent) parent.repeated = true;
    }
  }
  return false;
}

function applyLegacyMask(
  value: string,
  element: HTMLElement | null,
  maskFn?: (text: string, element: HTMLElement | null) => string,
): string {
  return maskFn ? maskFn(value, element) : value.replace(/[\S]/g, '*');
}

function maskSensitiveRanges(value: string, matches: SensitiveMatch[]): string {
  if (!matches.length) return value;
  let result = '';
  let cursor = 0;
  for (const match of matches) {
    result += value.slice(cursor, match.start);
    result += replacePreservingShape(value.slice(match.start, match.end));
    cursor = match.end;
  }
  return result + value.slice(cursor);
}

function mergeMatches(matches: SensitiveMatch[]): SensitiveMatch[] {
  const sorted = matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: SensitiveMatch[] = [];
  for (const match of sorted) {
    const previous = result[result.length - 1];
    if (previous && match.start <= previous.end) {
      previous.end = Math.max(previous.end, match.end);
      continue;
    }
    result.push({ ...match });
  }
  return result;
}

function ensureGlobalFlag(flags = ''): string {
  return flags.includes('g') ? flags : `${flags}g`;
}

function parentElementAcrossShadowRoot(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return 'host' in root && root.host instanceof Element ? root.host : null;
}
