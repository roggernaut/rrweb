import type {
  CompiledPrivacyPolicy,
  PrivacyDetectorOptions,
  PrivacyPolicy,
} from './types';

const VENDOR_MASK_CLASSES =
  '.rr-mask,.mp-mask,.fs-mask,.amp-mask,.ph-mask,.sentry-mask,[data-sentry-mask]';
const VENDOR_UNMASK_CLASSES =
  '.rr-unmask,.amp-unmask,.sentry-unmask,[data-sentry-unmask]';
const VENDOR_BLOCK_CLASSES =
  '.rr-block,.mp-block,.fs-exclude,.amp-block,.ph-no-capture,.sentry-block';
const PRIVACY_PRESETS = new Set(['strict', 'balanced', 'legacy']);
const MASKED_ATTRIBUTE_DEFAULTS = ['title', 'placeholder', 'aria-label'];

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

export const DEFAULT_PRIVACY_DETECTORS: Required<PrivacyDetectorOptions> = {
  email: true,
  phone: true,
  paymentCard: true,
  ssn: true,
  ipAddress: true,
};

/**
 * Opt into Highlight-style heuristic PII detectors (email, phone, Luhn card,
 * SSN-like, IPv4). These are not implied by `balanced` or `strict`; load them
 * through this helper or `@rrweb/rrweb-plugin-privacy-detectors`.
 */
export function applyPrivacyDetectors(
  policy: PrivacyPolicy | undefined,
  options?: Partial<typeof DEFAULT_PRIVACY_DETECTORS>,
): PrivacyPolicy {
  const base: PrivacyPolicy = policy || { version: 1, preset: 'balanced' };
  return {
    ...base,
    detectors: {
      ...DEFAULT_PRIVACY_DETECTORS,
      ...options,
      ...base.detectors,
    },
  };
}

export function validateSelector(selector: string): boolean {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

function joinSelectors(selectors: Array<string | null | undefined>): string | null {
  const kept: string[] = [];
  for (const s of selectors) {
    if (!s) continue;
    if (!validateSelector(s)) {
      console.warn(`[rrweb privacy] dropping invalid selector: ${s}`);
      continue;
    }
    kept.push(s);
  }
  return kept.join(',') || null;
}

export function compilePrivacyPolicy(policy?: PrivacyPolicy): CompiledPrivacyPolicy {
  const effective: PrivacyPolicy = policy || { version: 1, preset: 'legacy' };
  if (effective.version !== 1)
    throw new Error(`Unsupported Privacy at Capture policy version: ${String(effective.version)}`);
  if (!PRIVACY_PRESETS.has(effective.preset))
    throw new Error(`Unsupported privacy preset: ${String(effective.preset)}`);
  const preset = effective.preset;
  const nonLegacy = preset !== 'legacy';

  const bySelector = { mask: [] as string[], unmask: [] as string[], exclude: [] as string[] };
  for (const rule of effective.rules || []) {
    if (!rule.target || rule.target.type !== 'selector' || !rule.target.selector)
      throw new Error('Privacy rules require a non-empty selector target');
    const action = rule.action === 'allow' ? 'unmask' : rule.action;
    if (!(action in bySelector))
      throw new Error(`Unsupported privacy action: ${String(rule.action)}`);
    bySelector[action as keyof typeof bySelector].push(rule.target.selector);
  }

  return {
    policy: effective,
    preset,
    maskTextSelector: nonLegacy
      ? preset === 'strict'
        ? '*'
        : joinSelectors(['[data-privacy="mask"]', VENDOR_MASK_CLASSES, ...bySelector.mask])
      : joinSelectors(bySelector.mask.length ? ['[data-privacy="mask"]', ...bySelector.mask] : []),
    unmaskTextSelector: joinSelectors(
      nonLegacy
        ? ['[data-privacy="allow"]', VENDOR_UNMASK_CLASSES, ...bySelector.unmask]
        : bySelector.unmask,
    ),
    blockSelector: joinSelectors(
      nonLegacy
        ? ['[data-privacy="exclude"]', VENDOR_BLOCK_CLASSES, ...bySelector.exclude]
        : bySelector.exclude.length ? ['[data-privacy="exclude"]', ...bySelector.exclude] : [],
    ),
    maskAllInputs: nonLegacy,
    maskedAttributes: nonLegacy ? [...MASKED_ATTRIBUTE_DEFAULTS] : [],
    blockMedia: preset === 'strict',
    sanitizeUrls: nonLegacy,
    blockedQueryParameters: new Set(
      [...DEFAULT_BLOCKED_QUERY_PARAMETERS, ...(effective.url?.blockedQueryParameters || [])].map(
        (n) => n.toLowerCase(),
      ),
    ),
    allowedQueryParameters: effective.url?.allowedQueryParameters
      ? new Set(effective.url.allowedQueryParameters.map((n) => n.toLowerCase()))
      : null,
    removeHash: effective.url?.removeHash !== false,
    detectors: [], // populated by applyPrivacyDetectors (Task 2)
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

export function isProtectedInput(element: HTMLElement): boolean {
  // Task 9 replaces with untaintedTagName. A shadowed/non-string `tagName`
  // (e.g. <input name="tagName">) fails closed: treat as protected.
  const t: unknown = element.tagName;
  if (typeof t !== 'string') return true;
  if (t !== 'INPUT') return false;
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

export function sanitizeUrl(
  value: string,
  _privacy: CompiledPrivacyPolicy | undefined,
): string {
  // Task 3 reimplements
  return value;
}
