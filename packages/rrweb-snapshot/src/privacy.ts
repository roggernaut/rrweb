import type {
  CompiledDetector,
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

// Detector patterns (from posthog-js autocapture-utils.ts)
const CARD_CANDIDATE = /(?:^|[^0-9-])((?:\d[ -]?){12,18}\d)(?:$|[^0-9-])/;
const SSN_PATTERN = /\b(?!000|666|9\d{2})\d{3}-?(?!00)\d{2}-?(?!0000)\d{4}\b/;
const EMAIL_PATTERN =
  /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63})+/;
const PHONE_PATTERN = /(?:^|\s)\+?\d[\d ().-]{7,13}\d(?:$|\s)/;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const MAX_SCAN_LENGTH = 10_000;

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
  options?: PrivacyDetectorOptions,
): PrivacyPolicy {
  const base: PrivacyPolicy = policy || { version: 1, preset: 'legacy' };
  return {
    ...base,
    detectors: {
      ...DEFAULT_PRIVACY_DETECTORS,
      ...options,
      ...base.detectors,
    },
  };
}

export function buildDetectors(options: PrivacyDetectorOptions | undefined): CompiledDetector[] {
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
  if (opts.ssn) detectors.push({ name: 'ssn', test: (v) => SSN_PATTERN.test(v) });
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

export function detectSensitiveValue(value: string, privacy: CompiledPrivacyPolicy): boolean {
  if (!privacy.detectors.length || !value) return false;
  // Fail closed on absurd inputs instead of scanning them.
  if (value.length > MAX_SCAN_LENGTH) return true;
  return privacy.detectors.some((d) => d.test(value));
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
    detectors: buildDetectors(effective.detectors),
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

export function mergeMaskTextSelectors(
  legacySelector: string | null,
  privacy: CompiledPrivacyPolicy | undefined,
): string | null {
  return (
    [legacySelector, privacy?.maskTextSelector].filter(Boolean).join(',') || null
  );
}

export function mergeUnmaskTextSelectors(
  legacySelector: string | null,
  privacy: CompiledPrivacyPolicy | undefined,
): string | null {
  return (
    [legacySelector, privacy?.unmaskTextSelector].filter(Boolean).join(',') ||
    null
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

export function sanitizeUrl(value: string, privacy: CompiledPrivacyPolicy | undefined): string {
  if (!privacy || !privacy.sanitizeUrls) return value;
  try {
    const url = new URL(value, 'https://rrweb.invalid');
    url.username = '';
    url.password = '';
    for (const [name] of url.searchParams) {
      const lower = name.toLowerCase();
      if (
        (privacy.preset === 'strict' && !privacy.allowedQueryParameters) ||
        (privacy.allowedQueryParameters && !privacy.allowedQueryParameters.has(lower)) ||
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
    return ''; // fail closed: an unparseable URL is not recorded
  }
}
