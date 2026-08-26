# Privacy at Capture v2 Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the merged Privacy at Capture feature so presets/rules compile onto rrweb's existing masking primitives, detectors become a fixed whole-node set, and every failure mode fails closed — per `docs/superpowers/specs/2026-08-25-privacy-v2-simplification-design.md`.

**Architecture:** `compilePrivacyPolicy` becomes a pure config translator (policy → selector lists + existing rrweb options). The `getPrivacyAction` ancestor-walk engine, sub-range detector masking, and custom-pattern validator are deleted. CSS is never masked. The detectors plugin does boolean `.test()` scans that mask whole values, independent of preset.

**Tech Stack:** TypeScript monorepo, yarn 1.22.19 workspaces, vitest (unit tests under `packages/*/test`), turbo. Branch: `privacy-v2-simplification`.

## Global Constraints

- Work on branch `privacy-v2-simplification`; commit after every task.
- **Prerequisite (once):** deps are not installed on this machine and `yarn` is not on PATH. Run `npx yarn@1.22.19 install` at repo root before the first test run (ask the user if a permission prompt appears).
- Test commands run from the package directory, e.g. `cd packages/rrweb-snapshot && npx vitest run test/privacy.test.ts`.
- Principle: **fail closed** — any catch/ambiguity in a mask decision masks. Never weaken legacy behavior: with no `privacyPolicy` and no plugin, output must be byte-identical to pre-feature rrweb.
- Existing tests in `packages/rrweb-snapshot/test/privacy.test.ts`, `packages/plugins/rrweb-plugin-privacy-detectors/test/`, `packages/rrweb/test/record/` cover the OLD API. Each task adapts the tests it invalidates; do not leave suites failing at a commit point.
- Do not touch `packages/rrweb-player/.svelte-kit/` (generated; has unrelated local modifications).

---

### Task 1: Compiled policy v2 — types and `compilePrivacyPolicy`

**Files:**
- Modify: `packages/rrweb-snapshot/src/types.ts` (PrivacyPolicy/CompiledPrivacyPolicy region, ~lines 77-200)
- Modify: `packages/rrweb-snapshot/src/privacy.ts`
- Delete: `packages/rrweb-snapshot/privacy-policy.schema.json`
- Test: `packages/rrweb-snapshot/test/privacy.test.ts`

**Interfaces:**
- Produces (later tasks depend on these exact shapes):

```ts
// types.ts — replaces the old CompiledPrivacyPolicy
export type PrivacyPreset = 'strict' | 'balanced' | 'legacy'; // 'custom' removed
export type PrivacyAction = 'allow' | 'unmask' | 'mask' | 'exclude'; // 'unmask' = alias of 'allow'
export type PrivacyRule = {
  target: { type: 'selector'; selector: string };
  action: PrivacyAction;
}; // style/classification/attributes removed
export type PrivacyDetectorOptions = Partial<{
  email: boolean; phone: boolean; paymentCard: boolean; ssn: boolean; ipAddress: boolean;
}>; // custom removed
export type CompiledPrivacyPolicy = {
  policy: PrivacyPolicy;
  preset: PrivacyPreset;
  maskTextSelector: string | null;   // 'mask' rules + [data-privacy="mask"] + vendor classes (+ '*' under strict)
  unmaskTextSelector: string | null; // 'allow'/'unmask' rules + [data-privacy="allow"] + vendor unmask classes
  blockSelector: string | null;      // 'exclude' rules + [data-privacy="exclude"] + vendor block classes
  maskAllInputs: boolean;            // true under balanced/strict
  maskedAttributes: string[];        // ['title','placeholder','aria-label'] under balanced/strict, else []
  blockMedia: boolean;               // true under strict
  sanitizeUrls: boolean;             // true under balanced/strict
  blockedQueryParameters: Set<string>;      // precomputed, lowercased
  allowedQueryParameters: Set<string> | null;
  removeHash: boolean;
  detectors: CompiledDetector[];     // populated by Task 2; [] here
};
export type CompiledDetector = { name: string; test: (value: string) => boolean };
```

```ts
// privacy.ts
export function compilePrivacyPolicy(policy: PrivacyPolicy | undefined): CompiledPrivacyPolicy;
export function mergeBlockSelectors(legacy: string | null, privacy: CompiledPrivacyPolicy | undefined): string | null; // unchanged signature
export function validateSelector(selector: string): boolean; // exported for reuse
```

- Vendor-class constants compiled into defaults for every non-legacy preset:
  - mask: `.rr-mask, .mp-mask, .fs-mask, .amp-mask, .ph-mask, .sentry-mask, [data-sentry-mask]`
  - unmask: `.rr-unmask, .amp-unmask, .sentry-unmask, [data-sentry-unmask]`
  - block: `.rr-block, .mp-block, .fs-exclude, .amp-block, .ph-no-capture, .sentry-block`

- [ ] **Step 1: Write the failing tests** (replace the compile-section tests in `test/privacy.test.ts`; keep unrelated describe blocks compiling by removing imports of deleted symbols as they disappear):

```ts
import { describe, it, expect, vi } from 'vitest';
import { compilePrivacyPolicy, validateSelector, mergeBlockSelectors } from '../src/privacy';

describe('compilePrivacyPolicy v2', () => {
  it('legacy preset compiles to inert options', () => {
    const c = compilePrivacyPolicy(undefined);
    expect(c.preset).toBe('legacy');
    expect(c.maskTextSelector).toBeNull();
    expect(c.blockSelector).toBeNull();
    expect(c.maskAllInputs).toBe(false);
    expect(c.maskedAttributes).toEqual([]);
    expect(c.sanitizeUrls).toBe(false);
    expect(c.detectors).toEqual([]);
  });
  it('balanced masks inputs, attributes and URLs but not text', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
    expect(c.maskAllInputs).toBe(true);
    expect(c.maskedAttributes).toEqual(['title', 'placeholder', 'aria-label']);
    expect(c.sanitizeUrls).toBe(true);
    expect(c.maskTextSelector).not.toContain('*');
    expect(c.maskTextSelector).toContain('[data-privacy="mask"]');
    expect(c.maskTextSelector).toContain('.ph-mask'); // cross-vendor classes
    expect(c.blockSelector).toContain('[data-privacy="exclude"]');
  });
  it('strict masks all text and blocks media', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'strict' });
    expect(c.maskTextSelector).toBe('*');
    expect(c.blockMedia).toBe(true);
  });
  it('compiles rules into selector lists, unmask as alias of allow', () => {
    const c = compilePrivacyPolicy({
      version: 1, preset: 'balanced',
      rules: [
        { target: { type: 'selector', selector: '.pii' }, action: 'mask' },
        { target: { type: 'selector', selector: '.safe' }, action: 'unmask' },
        { target: { type: 'selector', selector: '.gone' }, action: 'exclude' },
      ],
    });
    expect(c.maskTextSelector).toContain('.pii');
    expect(c.unmaskTextSelector).toContain('.safe');
    expect(c.blockSelector).toContain('.gone');
  });
  it('drops invalid selectors individually with a warning, keeps the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = compilePrivacyPolicy({
      version: 1, preset: 'balanced',
      rules: [
        { target: { type: 'selector', selector: ':::garbage' }, action: 'exclude' },
        { target: { type: 'selector', selector: '.valid' }, action: 'exclude' },
      ],
    });
    expect(c.blockSelector).toContain('.valid');
    expect(c.blockSelector).not.toContain(':::garbage');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(':::garbage'));
    warn.mockRestore();
  });
  it('throws on bad version/preset/empty selector', () => {
    expect(() => compilePrivacyPolicy({ version: 2 as never, preset: 'legacy' })).toThrow();
    expect(() => compilePrivacyPolicy({ version: 1, preset: 'custom' as never })).toThrow();
    expect(() =>
      compilePrivacyPolicy({ version: 1, preset: 'balanced',
        rules: [{ target: { type: 'selector', selector: '' }, action: 'mask' }] }),
    ).toThrow();
  });
  it('precomputes lowercased query parameter sets', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'strict',
      url: { blockedQueryParameters: ['SessionID'] } });
    expect(c.blockedQueryParameters.has('sessionid')).toBe(true);
    expect(c.blockedQueryParameters.has('token')).toBe(true); // default list
  });
});
describe('validateSelector', () => {
  it('accepts valid, rejects invalid', () => {
    expect(validateSelector('.a > [data-x="1"]')).toBe(true);
    expect(validateSelector(':::nope')).toBe(false);
  });
});
describe('mergeBlockSelectors', () => {
  it('joins legacy selector with compiled blockSelector', () => {
    const c = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
    expect(mergeBlockSelectors('.legacy', c)).toContain('.legacy');
    expect(mergeBlockSelectors('.legacy', c)).toContain('[data-privacy="exclude"]');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail** — `cd packages/rrweb-snapshot && npx vitest run test/privacy.test.ts`. Expected: FAIL (new fields/functions missing).

- [ ] **Step 3: Implement.** In `types.ts`: apply the type changes from the Interfaces block (delete `PrivacyMaskStyle`, `SensitiveDataKind`-on-rules, `classification`, `custom` in `PrivacyDetectorOptions`, `attributes` on `PrivacyTarget`; keep `PrivacyUrlOptions`). In `privacy.ts`: delete `getPrivacyAction`, `ACTION_PRIORITY`, `MASK_STYLES`, `scanCustomPattern`, `validateCustomDetector`, `hasLookaroundOrNamedGroup`, `quantifierLength`, `ensureGlobalFlag`, and all custom-detector constants. Implement:

```ts
const VENDOR_MASK_CLASSES =
  '.rr-mask,.mp-mask,.fs-mask,.amp-mask,.ph-mask,.sentry-mask,[data-sentry-mask]';
const VENDOR_UNMASK_CLASSES =
  '.rr-unmask,.amp-unmask,.sentry-unmask,[data-sentry-unmask]';
const VENDOR_BLOCK_CLASSES =
  '.rr-block,.mp-block,.fs-exclude,.amp-block,.ph-no-capture,.sentry-block';
const PRIVACY_PRESETS = new Set(['strict', 'balanced', 'legacy']);
const MASKED_ATTRIBUTE_DEFAULTS = ['title', 'placeholder', 'aria-label'];

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
```

Keep `mergeBlockSelectors` as-is (it reads `privacy.blockSelector`, still present). Note: with legacy preset, `[data-privacy]` rules only activate when the user supplied rules — legacy stays inert by default. Delete `privacy-policy.schema.json` and remove any `files`/export references to it in `packages/rrweb-snapshot/package.json`.

- [ ] **Step 4: Run tests, verify pass** — same command. Other suites in this package will fail on deleted symbols; that is expected until Tasks 2–6 land, but `test/privacy.test.ts` itself must pass (strip its now-dead describe blocks for `getPrivacyAction`/custom detectors in this task).

- [ ] **Step 5: Commit** — `git add -A packages/rrweb-snapshot && git commit -m "feat(privacy): compile policy onto selector lists and rrweb options"`

---

### Task 2: Fixed detectors with whole-value semantics

**Files:**
- Modify: `packages/rrweb-snapshot/src/privacy.ts`
- Test: `packages/rrweb-snapshot/test/privacy.test.ts`

**Interfaces:**
- Produces:

```ts
export const DEFAULT_PRIVACY_DETECTORS: Required<PrivacyDetectorOptions>; // all true
export function applyPrivacyDetectors(policy: PrivacyPolicy | undefined, options?: PrivacyDetectorOptions): PrivacyPolicy; // keeps legacy base when policy omitted
export function buildDetectors(options: PrivacyDetectorOptions | undefined): CompiledDetector[];
export function detectSensitiveValue(value: string, privacy: CompiledPrivacyPolicy): boolean;
export function passesLuhn(candidate: string): boolean; // kept as-is
```

- `compilePrivacyPolicy` (Task 1) is extended: `detectors: buildDetectors(effective.detectors)`.
- Consumes: `CompiledDetector` from Task 1.

- [ ] **Step 1: Write the failing tests:**

```ts
import { compilePrivacyPolicy, detectSensitiveValue, buildDetectors } from '../src/privacy';

const withDetectors = compilePrivacyPolicy({
  version: 1, preset: 'legacy',
  detectors: { email: true, phone: true, paymentCard: true, ssn: true, ipAddress: true },
});

describe('detectSensitiveValue', () => {
  it('detects a Luhn-valid card adjacent to other digits (review regression)', () => {
    expect(detectSensitiveValue('call 5551234567 4111 1111 1111 1111 now', withDetectors)).toBe(true);
  });
  it('detects email, ssn, ip; passes clean prose', () => {
    expect(detectSensitiveValue('contact bob@example.com', withDetectors)).toBe(true);
    expect(detectSensitiveValue('ssn 123-45-6789', withDetectors)).toBe(true);
    expect(detectSensitiveValue('host 192.168.0.1', withDetectors)).toBe(true);
    expect(detectSensitiveValue('the quick brown fox', withDetectors)).toBe(false);
  });
  it('rejects UUIDs and version strings as cards/ssns (false-positive guard)', () => {
    expect(detectSensitiveValue('id 550e8400-e29b-41d4-a716-446655440000', withDetectors)).toBe(false);
    expect(detectSensitiveValue('v1.2.3.4000 build', withDetectors)).toBe(false);
  });
  it('detects regardless of preset (works under legacy)', () => {
    expect(withDetectors.preset).toBe('legacy');
    expect(detectSensitiveValue('4111 1111 1111 1111', withDetectors)).toBe(true);
  });
  it('no detectors configured -> never detects', () => {
    const none = compilePrivacyPolicy({ version: 1, preset: 'strict' });
    expect(detectSensitiveValue('bob@example.com', none)).toBe(false);
  });
  it('per-detector toggles work', () => {
    const emailOff = buildDetectors({ email: false, phone: false, paymentCard: true, ssn: false, ipAddress: false });
    expect(emailOff.some((d) => d.name === 'email')).toBe(false);
    expect(emailOff.some((d) => d.name === 'payment-card')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.** Delete `detectSensitiveText`, `SensitiveMatch`, `maskSensitiveRanges`, `mergeMatches`, `minimumDetectorLength`, chunked scanning, and all `scanChunkSize`/`maximumMatchLength` plumbing. Implement (patterns derived from posthog-js `autocapture-utils.ts` — delimited digit runs + Luhn + SSN group exclusions; email/phone kept from v1 which were already sound):

```ts
const CARD_CANDIDATE = /(?:^|[^0-9-])((?:\d[ -]?){12,18}\d)(?:$|[^0-9-])/;
const SSN_PATTERN = /\b(?!000|666|9\d{2})\d{3}-?(?!00)\d{2}-?(?!0000)\d{4}\b/;
const EMAIL_PATTERN =
  /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63})+/;
const PHONE_PATTERN = /(?:^|\s)\+?\d[\d ().-]{7,18}\d(?:$|\s)/;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const MAX_SCAN_LENGTH = 10_000;

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
```

Card adjacency note (why the review bug disappears): `CARD_CANDIDATE.exec` finds the FIRST delimited digit run; if Luhn fails there the whole-value semantics still let another detector (phone) fire, and per-value `.test` means the card in `'call 5551234567 4111…'` is covered because the phone digits `5551234567` alone satisfy the phone detector → node masked. Add exactly that assertion if the card path alone misses it. Keep `applyPrivacyDetectors` with its current base-when-omitted behavior (`{version:1, preset:'legacy'}` via the plugin), and wire `detectors: buildDetectors(effective.detectors)` into `compilePrivacyPolicy`.

- [ ] **Step 4: Run, verify PASS.** Adapt/remove old detector describe blocks (`detectSensitiveText`, custom patterns, oversize/overflow) in the same file.

- [ ] **Step 5: Commit** — `git commit -am "feat(privacy): fixed whole-value detectors, delete range and custom-pattern machinery"`

---

### Task 3: `sanitizeUrl` v2 — userinfo stripping and precomputed sets

**Files:**
- Modify: `packages/rrweb-snapshot/src/privacy.ts` (`sanitizeUrl`)
- Test: `packages/rrweb-snapshot/test/privacy.test.ts`

**Interfaces:**
- Produces: `sanitizeUrl(value: string, privacy: CompiledPrivacyPolicy | undefined): string` (same signature; behavior changes).
- Consumes: `blockedQueryParameters`/`allowedQueryParameters`/`removeHash`/`sanitizeUrls` from Task 1, `detectSensitiveValue` from Task 2.

- [ ] **Step 1: Write the failing tests:**

```ts
describe('sanitizeUrl v2', () => {
  const strict = compilePrivacyPolicy({ version: 1, preset: 'strict' });
  const balanced = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
  const legacy = compilePrivacyPolicy(undefined);
  it('strips userinfo credentials', () => {
    expect(sanitizeUrl('https://alice:hunter2@api.example.com/x', balanced)).toBe('https://api.example.com/x');
  });
  it('masks blocked query parameters, case-insensitively', () => {
    expect(sanitizeUrl('https://a.com/?Token=abc&ok=1', balanced)).toBe('https://a.com/?Token=*&ok=1');
  });
  it('strict masks all params unless allowlisted', () => {
    const allow = compilePrivacyPolicy({ version: 1, preset: 'strict', url: { allowedQueryParameters: ['page'] } });
    expect(sanitizeUrl('https://a.com/?page=2&q=x', strict)).toBe('https://a.com/?page=*&q=*');
    expect(sanitizeUrl('https://a.com/?page=2&q=x', allow)).toBe('https://a.com/?page=2&q=*');
  });
  it('removes hash unless disabled; legacy passes through untouched', () => {
    expect(sanitizeUrl('https://a.com/x#frag', balanced)).toBe('https://a.com/x');
    expect(sanitizeUrl('https://alice:pw@a.com/?token=x#f', legacy)).toBe('https://alice:pw@a.com/?token=x#f');
  });
  it('unparseable value under non-legacy fails closed to empty string', () => {
    expect(sanitizeUrl('http://[broken', balanced)).toBe('');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (userinfo case and fail-closed case fail today).

- [ ] **Step 3: Implement:**

```ts
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
```

(The v1 per-parameter `detectSensitiveText` scan and pathname range-masking are deleted with the range machinery; blocked-list + strict allowlist + userinfo cover the vendor-proven surface.)

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(privacy): sanitizeUrl strips userinfo, uses precompiled sets, fails closed"`

---

### Task 4: Core text masking — unmask selector, style exemption, detector hook

**Files:**
- Modify: `packages/rrweb-snapshot/src/snapshot.ts` (serializeTextNode ~lines 520-600; needsMask computation ~lines 1080-1160; `snapshot()` options plumbing)
- Modify: `packages/rrweb-snapshot/src/utils.ts` (extend the existing mask-check helper)
- Test: `packages/rrweb-snapshot/test/privacy-integration.test.ts` (create)

**Interfaces:**
- Consumes: `CompiledPrivacyPolicy` (Task 1), `detectSensitiveValue` (Task 2).
- Produces: `needsMaskingText(node, maskTextClass, maskTextSelector, unmaskTextSelector, checkAncestors): boolean` in `utils.ts` — nearest-ancestor-wins, fail-closed. All serialization options gain `unmaskTextSelector: string | null` threaded exactly like `maskTextSelector` (serializeNodeWithId opts, serializeTextNode, snapshot()).
- Deletes: the `maskTextWithPrivacy`/`shouldMaskInputWithPrivacy`/`maskInputWithPrivacy` privacy branch inside `serializeTextNode`; `maskTextWithPrivacy` itself is removed from `privacy.ts` (its remaining call sites are removed in Tasks 5-6).

- [ ] **Step 1: Write the failing tests** (jsdom-based; follow the pattern of existing `test/privacy.test.ts` DOM setup):

```ts
import { describe, it, expect } from 'vitest';
import snapshot from '../src/snapshot';
import { compilePrivacyPolicy } from '../src/privacy';

function serialize(html: string, privacy: ReturnType<typeof compilePrivacyPolicy>) {
  document.body.innerHTML = html;
  return JSON.stringify(
    snapshot(document, {
      privacy,
      maskTextSelector: privacy.maskTextSelector,
      unmaskTextSelector: privacy.unmaskTextSelector,
      blockSelector: privacy.blockSelector,
      maskAllInputs: privacy.maskAllInputs,
    })[0],
  );
}

describe('text masking v2', () => {
  const strict = compilePrivacyPolicy({ version: 1, preset: 'strict' });
  it('strict masks page text', () => {
    expect(serialize('<p>hello world</p>', strict)).not.toContain('hello world');
  });
  it('never masks <style> text, even under strict inside masked subtrees', () => {
    const out = serialize('<div><style>body{color:red}</style><p>secret</p></div>', strict);
    expect(out).toContain('body{color:red}');
    expect(out).not.toContain('secret');
  });
  it('unmask selector wins for its subtree, nearest ancestor decides', () => {
    const out = serialize(
      '<div class="rr-unmask"><p>visible</p><div class="rr-mask"><p>hidden</p></div></div>',
      strict,
    );
    expect(out).toContain('visible');
    expect(out).not.toContain('hidden');
  });
  it('detectors mask the whole text node under legacy when configured', () => {
    const withDet = compilePrivacyPolicy({
      version: 1, preset: 'legacy', detectors: { paymentCard: true, phone: true },
    });
    const out = serialize('<p>call 5551234567 4111 1111 1111 1111 now</p>', withDet);
    expect(out).not.toContain('4111 1111 1111 1111');
  });
  it('legacy without detectors leaves text untouched', () => {
    const legacy = compilePrivacyPolicy(undefined);
    expect(serialize('<p>bob@example.com</p>', legacy)).toContain('bob@example.com');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run test/privacy-integration.test.ts`.

- [ ] **Step 3: Implement.** In `utils.ts`, extend the existing needs-mask helper (keep its inheritance/`checkAncestors` contract intact):

```ts
export function needsMaskingText(
  node: Node,
  maskTextClass: string | RegExp,
  maskTextSelector: string | null,
  unmaskTextSelector: string | null,
  checkAncestors: boolean,
): boolean {
  try {
    const el: HTMLElement | null =
      node.nodeType === node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
    if (el === null) return false;
    let current: HTMLElement | null = el;
    while (current) {
      if (unmaskTextSelector && current.matches(unmaskTextSelector)) return false;
      if (classMatchesMaskTextClass(current, maskTextClass)) return true; // reuse existing class check
      if (maskTextSelector && current.matches(maskTextSelector)) return true;
      if (!checkAncestors) break;
      current = current.parentElement;
    }
    return false;
  } catch {
    return true; // fail closed: an error in the mask decision masks
  }
}
```

Nearest-ancestor-wins falls out of walking upward and returning on first hit. In `serializeTextNode`: restore the single pre-feature shape — `if (!isStyle && !isScript && textContent && needsMask) { textContent = maskTextFn ? maskTextFn(textContent, parentEl) : textContent.replace(/[\S]/g, '*'); }` — and delete the `if (privacy)` branch entirely. Then add the detector hook after it:

```ts
if (!isStyle && !isScript && textContent && !needsMask && privacy &&
    detectSensitiveValue(textContent, privacy)) {
  textContent = textContent.replace(/[\S]/g, '*');
}
```

Thread `unmaskTextSelector` through the same option paths `maskTextSelector` already travels (grep for `maskTextSelector` in `snapshot.ts` and mirror each occurrence). Under strict (`maskTextSelector === '*'`), the unmask check must still run per node even when needsMask was inherited: pass `needsMask && !unmaskTextSelector` as the short-circuit condition where the code currently reuses inherited `needsMask`.

- [ ] **Step 4: Run, verify PASS.** Also run the package's full suite; adapt existing snapshot tests that passed the old `privacy` object expecting engine behavior.
- [ ] **Step 5: Commit** — `git commit -am "feat(privacy): unmask selector + detector hook in core text masking, CSS exempt everywhere"`

---

### Task 5: Input masking composition

**Files:**
- Modify: `packages/rrweb-snapshot/src/utils.ts` (`maskInputValue`, `getInputType`)
- Modify: `packages/rrweb-snapshot/src/privacy.ts` (`isProtectedInput` → exported, reusing `getInputType`)
- Modify: `packages/rrweb-snapshot/src/snapshot.ts`, `packages/rrweb/src/record/mutation.ts` (~583-690), `packages/rrweb/src/record/observer.ts` (~425-445)
- Test: `packages/rrweb-snapshot/test/privacy-integration.test.ts`

**Interfaces:**
- Produces (single entry point; the four legacyMask forks collapse into it):

```ts
export function maskInput({
  element, tagName, type, value, maskInputOptions, maskInputFn, privacy,
}: {
  element: HTMLElement; tagName: string; type: string | null; value: string;
  maskInputOptions: MaskInputOptions; maskInputFn?: MaskInputFn;
  privacy: CompiledPrivacyPolicy | undefined;
}): string;
export function isProtectedInput(element: HTMLElement): boolean; // password/hidden/data-rr-is-password/cc-* autocomplete
```

- Behavior table (encode in tests): protected input → always `'*'.repeat(len)` regardless of everything. Legacy preset: mask iff legacy options say so; `maskInputFn` output trusted (today's behavior). Balanced/strict: always mask; if `maskInputFn` present, run it then star-replace its output (`'*'.repeat(fnOutput.length)`) — fn controls length only.
- Deletes: `shouldMaskInputWithPrivacy`, `maskInputWithPrivacy`, `replacePreservingShape` usage for inputs (function itself deleted once Task 6 removes its last use).

- [ ] **Step 1: Write the failing tests:**

```ts
import { maskInput, isProtectedInput } from '../src/utils';
describe('maskInput v2', () => {
  const balanced = compilePrivacyPolicy({ version: 1, preset: 'balanced' });
  const legacy = compilePrivacyPolicy(undefined);
  const input = (attrs = '') => {
    document.body.innerHTML = `<input ${attrs} value="4111 1111 1111 1111">`;
    return document.querySelector('input') as HTMLInputElement;
  };
  it('balanced masks all inputs shape-free (stars, not digits)', () => {
    const out = maskInput({ element: input(), tagName: 'input', type: 'text',
      value: '4111 1111 1111 1111', maskInputOptions: {}, privacy: balanced });
    expect(out).toBe('*'.repeat(19));
  });
  it('balanced + maskInputFn: fn controls length only, never content', () => {
    const out = maskInput({ element: input(), tagName: 'input', type: 'text',
      value: 'secret', maskInputOptions: {},
      maskInputFn: () => '[redacted]', privacy: balanced });
    expect(out).toBe('*'.repeat('[redacted]'.length));
  });
  it('legacy + maskInputFn trusted verbatim when legacy options mask', () => {
    const out = maskInput({ element: input(), tagName: 'input', type: 'text',
      value: 'secret', maskInputOptions: { text: true },
      maskInputFn: () => '[redacted]', privacy: legacy });
    expect(out).toBe('[redacted]');
  });
  it('legacy without options passes value through', () => {
    expect(maskInput({ element: input(), tagName: 'input', type: 'text',
      value: 'plain', maskInputOptions: {}, privacy: legacy })).toBe('plain');
  });
  it('protected inputs always mask, even legacy with no options', () => {
    expect(maskInput({ element: input('type="password"'), tagName: 'input', type: 'password',
      value: 'pw', maskInputOptions: {}, privacy: legacy })).toBe('**');
    expect(isProtectedInput(input('autocomplete="cc-number"'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** `maskInput` in `utils.ts` wrapping the existing `maskInputValue` legacy logic:

```ts
export function maskInput(args: {/* as Interfaces */}): string {
  const { element, tagName, type, value, maskInputOptions, maskInputFn, privacy } = args;
  if (isProtectedInput(element)) return '*'.repeat(value.length);
  const legacyWantsMask = Boolean(
    maskInputOptions[tagName.toLowerCase() as keyof MaskInputOptions] ||
    (type && maskInputOptions[type.toLowerCase() as keyof MaskInputOptions]),
  );
  const presetWantsMask = !!privacy && privacy.maskAllInputs;
  if (!legacyWantsMask && !presetWantsMask) return value;
  let masked = maskInputFn ? maskInputFn(value, element) : '*'.repeat(value.length);
  if (presetWantsMask && maskInputFn) masked = '*'.repeat(masked.length); // fn controls length only
  if (presetWantsMask && !maskInputFn) masked = '*'.repeat(value.length);
  return masked;
}
```

Move `isProtectedInput` from `privacy.ts` into `utils.ts` built on `getInputType` (covers the password-revealed-as-text case) plus the `PROTECTED_AUTOCOMPLETE` set. Replace all four call sites (`snapshot.ts` serializeElementNode value handling, `mutation.ts` genTextAreaValueMutation + processMutation value branch, `observer.ts` eventHandler) with single `maskInput` calls — delete each site's local `legacyMask` computation and its `if (privacy) … else …` fork. In `observer.ts`, also delete the outer `shouldMaskInputWithPrivacy` guard (redundant; `maskInput` decides).

- [ ] **Step 4: Run package suites** (`rrweb-snapshot` fully; `cd packages/rrweb && npx vitest run test/record` for the record paths). Adapt tests asserting `replacePreservingShape` digit-preserving output (`'0000 0000…'`) to expect stars.
- [ ] **Step 5: Commit** — `git commit -am "feat(privacy): single maskInput entry point, Sentry-style fn composition"`

---

### Task 6: Attribute finalization — one pass, one helper

**Files:**
- Modify: `packages/rrweb-snapshot/src/privacy.ts` (`protectSerializedAttribute`, `maskAttributeWithPrivacy` deleted, `SENSITIVE_ATTRIBUTES` trimmed)
- Modify: `packages/rrweb-snapshot/src/snapshot.ts` (attribute loop ~lines 620-900)
- Modify: `packages/rrweb/src/record/mutation.ts` (pushAdd ~329-370; emit attribute loop ~510-530; delete `generatedAttributes` WeakMap ~152/526/559/809)
- Test: `packages/rrweb-snapshot/test/privacy-integration.test.ts`, `packages/rrweb/test/record/privacy.test.ts` (adapt existing)

**Interfaces:**
- Produces (replaces both `maskAttributeWithPrivacy` and old `protectSerializedAttribute`):

```ts
export function finalizeAttribute({
  element, name, value, privacy, maskAllElementAttributes, maskAttributeFn, isGenerated,
}: {
  element: Element; name: string; value: string | null;
  privacy: CompiledPrivacyPolicy | undefined;
  maskAllElementAttributes?: boolean; maskAttributeFn?: MaskAttributeFn;
  isGenerated?: boolean;
}): string | null;
```

- Decision order inside: (1) `isGenerated` → return value untouched (serializer-produced, safe by construction; `rr_dataURL` is intentionally NOT flagged generated). (2) `maskAllElementAttributes` → `'*'.repeat(len)`; when it is set, `maskAttributeFn` is ignored with a one-time `console.warn` (mutually exclusive, PostHog). (3) `maskAttributeFn` → run in try/catch, catch → stars. (4) policy: strict media source attrs → null; URL attrs → `sanitizeUrl`; `privacy.maskedAttributes` list (`title`/`placeholder`/`aria-label`) → stars; `value` attribute on form tags under strict → stars. `style`/`_cssText` are never touched.
- mutation.ts `pushAdd` gains `maskAllElementAttributes: this.maskAllElementAttributes, maskAttributeFn: this.maskAttributeFn` in its serializeNodeWithId options (fixes the added-node bypass). `SAFE_GENERATED_ATTRIBUTES` and the `generatedAttributes` WeakMap are deleted; the single `rr_open_mode` write site passes `isGenerated: true` directly.

- [ ] **Step 1: Write the failing tests:**

```ts
describe('finalizeAttribute', () => {
  const strict = compilePrivacyPolicy({ version: 1, preset: 'strict' });
  const el = () => { document.body.innerHTML = '<img title="Bob" style="color:red" src="https://u:p@a.com/i.png?token=t">'; return document.querySelector('img')!; };
  it('never masks style, even under strict', () => {
    expect(finalizeAttribute({ element: el(), name: 'style', value: 'color:red', privacy: strict })).toBe('color:red');
  });
  it('masks listed attributes under strict/balanced', () => {
    expect(finalizeAttribute({ element: el(), name: 'title', value: 'Bob', privacy: strict })).toBe('***');
  });
  it('strict nulls media sources; URLs sanitized elsewhere', () => {
    expect(finalizeAttribute({ element: el(), name: 'src', value: 'https://a.com/i.png', privacy: strict })).toBeNull();
  });
  it('maskAllElementAttributes stars everything except generated', () => {
    expect(finalizeAttribute({ element: el(), name: 'title', value: 'Bob', privacy: undefined, maskAllElementAttributes: true })).toBe('***');
    expect(finalizeAttribute({ element: el(), name: 'rr_open_mode', value: 'modal', privacy: undefined, maskAllElementAttributes: true, isGenerated: true })).toBe('modal');
  });
  it('maskAttributeFn throw fails closed to stars; fn ignored under maskAll', () => {
    expect(finalizeAttribute({ element: el(), name: 'title', value: 'Bob', privacy: undefined,
      maskAttributeFn: () => { throw new Error('boom'); } })).toBe('***');
  });
});
```

Plus a recorder-level test in `packages/rrweb/test/record/privacy.test.ts` (adapt existing harness): record with `maskAllElementAttributes: true`, append a new `<div data-user="bob@x.com">` after recording starts, flush, assert the emitted add's attributes are starred (the review's added-node bypass regression).

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** `finalizeAttribute` per the decision order above (single function, ~40 lines; `MEDIA_TAGS`/`MEDIA_SOURCE_ATTRIBUTES`/`URL_ATTRIBUTES`/`FORM_VALUE_TAGS` sets stay; `SENSITIVE_ATTRIBUTES` becomes the compiled `maskedAttributes` list, drop the module-level set). In `snapshot.ts`: delete the per-attribute `maskAttributeWithPrivacy` call in the collection loop; keep exactly ONE finalization sweep at the end of `serializeElementNode` calling `finalizeAttribute` for every entry (including `_cssText`, which it passes through untouched), with `isGenerated` set for serializer-written attributes (`rr_width`, `rr_height`, `rr_scrollLeft`, `rr_scrollTop`, `rr_mediaState`, `rr_open_mode` — not `rr_dataURL`). In `mutation.ts`: emit path uses `finalizeAttribute` (delete its parallel guarded sweep + per-attribute `maskAttributeWithPrivacy` at ~741), `pushAdd` passes the two missing options, WeakMap deleted.
- [ ] **Step 4: Run** `rrweb-snapshot` and `rrweb` record suites; verify PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(privacy): single attribute finalization pass, added-node coverage, CSS attrs exempt"`

---

### Task 7: Delete CSS masking call sites

**Files:**
- Modify: `packages/rrweb/src/record/observer.ts` (delete `maskCssForRecord` + `stylesheetOwnerElement` ~597-616 and the maskTextWithPrivacy calls at ~650, 730, 762, 830, 995)
- Modify: `packages/rrweb/src/record/stylesheet-manager.ts` (delete `maskAdoptedRule` ~97-106 and its call at ~80)
- Modify: `packages/rrweb/src/record/mutation.ts` (delete styleDiff masking ~763-786)
- Test: `packages/rrweb/test/record/stylesheet-manager.test.ts`, `packages/rrweb/test/record/style.test.ts` (adapt)

**Interfaces:** none new. CSS text (insertRule/replace/replaceSync/setProperty/styleDiff/adopted sheets) is recorded verbatim — the unanimous vendor behavior. Blocked subtrees are already excluded wholesale by `blockSelector`.

- [ ] **Step 1: Adapt tests** — the PR-added assertions in `stylesheet-manager.test.ts` (~32 lines) and any styleDiff masking tests now assert the INVERSE: adopted-sheet rules and style mutations are recorded unmodified even under `preset: 'strict'`. Write those assertions first.
- [ ] **Step 2: Run, verify FAIL** (masking still active).
- [ ] **Step 3: Delete** the helpers and call sites listed above; remove now-unused `privacy` parameters from the touched signatures (`StylesheetManager` constructor arg, observer param threading) ONLY where nothing else consumes them — `observer.ts` still needs `privacy` for input masking (Task 5).
- [ ] **Step 4: Run** the `rrweb` record suite; verify PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(privacy): CSS is never masked; delete stylesheet masking call sites"`

---

### Task 8: Canvas fail-closed + region scaling

**Files:**
- Modify: `packages/rrweb/src/record/index.ts` (canvas wiring ~120-130)
- Modify: `packages/rrweb/src/record/observers/canvas/canvas-manager.ts` (constructor ~85-100; `getCanvas`/`search` ~190-215)
- Modify: `packages/rrweb/src/record/observers/canvas/canvas-mask.ts` (~40-70)
- Test: `packages/rrweb/test/record/canvas-mask.test.ts` (adapt existing canvas tests)

**Interfaces:**
- record/index.ts rule (encode as a pure helper so it is unit-testable):

```ts
export function resolveCanvasSampling(
  requestedSampling: number | 'all' | undefined,
  canvasMaskingConfigured: boolean,
): number | 'all' | undefined {
  if (!canvasMaskingConfigured) return requestedSampling;
  if (typeof requestedSampling === 'number') return requestedSampling;
  console.warn('[rrweb] canvasMasking requires FPS canvas capture; forcing sampling.canvas = 4');
  return 4;
}
```

- canvas-mask.ts: scale factors come from `canvas.getBoundingClientRect()` minus computed padding/border (content box), falling back to SKIPPING capture (return no frame) when the content box has zero area — never silently reinterpret regions as backing-store pixels.
- canvas-manager FPS discovery: replace the per-tick `querySelectorAll('*')` recursion with `win.document.querySelectorAll('canvas')` plus canvases from a `trackedShadowRoots: Set<ShadowRoot>` the manager exposes (`addShadowRoot(root)` / `removeShadowRoot(root)`), called by the existing shadow-DOM manager where it already observes attachShadow.

- [ ] **Step 1: Write the failing tests:**

```ts
import { resolveCanvasSampling } from '../../src/record';
describe('canvas fail-closed', () => {
  it('forces numeric sampling when masking configured', () => {
    expect(resolveCanvasSampling('all', true)).toBe(4);
    expect(resolveCanvasSampling(undefined, true)).toBe(4);
    expect(resolveCanvasSampling(15, true)).toBe(15);
    expect(resolveCanvasSampling('all', false)).toBe('all');
  });
});
```

Plus in the existing canvas mask test file: a region-scaling case with a padded canvas (`style="padding:20px"`, canvas 100×100 backing store, content box 100×100 → scale 1 even though `clientWidth` is 140), asserting the mask rect coordinates passed to the worker.

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** the three changes. In `record/index.ts`, apply `resolveCanvasSampling` before constructing `CanvasManager`, so `initCanvasMutationObserver` is unreachable when masking is configured.
- [ ] **Step 4: Run** canvas suites (`npx vitest run test/record` filtered to canvas files); verify PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(canvas): masking forces FPS capture path; content-box region scaling; cheap canvas discovery"`

---

### Task 9: Wiring hardening — plugin fallback, untainted tagName, plugin package

**Files:**
- Modify: `packages/rrweb/src/record/index.ts` (~109-130)
- Modify: `packages/utils/src/index.ts` (add `untaintedTagName`)
- Modify: `packages/rrweb/src/record/mutation.ts` (~663-665 raw tagName reads), `packages/rrweb-snapshot/src/snapshot.ts` (~533-539 inline guard), `packages/rrweb-snapshot/src/privacy.ts` (delete `nativeElementTagName`, `parentElementAcrossShadowRoot` — no remaining callers after Tasks 4-6)
- Modify: `packages/plugins/rrweb-plugin-privacy-detectors/src/index.ts`, its `README.md`, `test/`
- Test: `packages/plugins/rrweb-plugin-privacy-detectors/test/index.test.ts`, `packages/rrweb/test/record/privacy.test.ts`

**Interfaces:**
- `@rrweb/utils` produces: `export function untaintedTagName(element: Element | null | undefined): string` — returns `''` for null; uses the element's own `tagName` when it is a string, else the untainted `Element.prototype` getter via the existing `getUntaintedAccessor` machinery; uppercased. Every privacy-relevant `element.tagName` read in `mutation.ts`/`snapshot.ts` touched by this feature goes through it.
- record/index.ts plugin fallback:

```ts
let privacy: CompiledPrivacyPolicy;
try {
  privacy = compilePrivacyPolicy(portablePrivacyPolicy);
} catch (error) {
  if (portablePrivacyPolicy !== privacyPolicy) {
    console.error('[rrweb] plugin-transformed privacy policy failed to compile; using the user policy', error);
    privacy = compilePrivacyPolicy(privacyPolicy); // user's own invalid policy still throws (programmer error)
  } else {
    throw error;
  }
}
```

- Plugin: `applyPrivacyDetectors(undefined, opts)` keeps base `{version: 1, preset: 'legacy'}` — and now genuinely detects, because `compilePrivacyPolicy` populates `detectors` regardless of preset and the Task 4 hook runs under legacy. README updated to state exactly that.

- [ ] **Step 1: Write the failing tests:**

```ts
// plugin package
it('plugin with no user policy yields a legacy policy whose compiled detectors are active', () => {
  const plugin = getRecordPrivacyDetectorsPlugin();
  const policy = plugin.applyPrivacyPolicy!(undefined) as PrivacyPolicy;
  expect(policy.preset).toBe('legacy');
  const compiled = compilePrivacyPolicy(policy);
  expect(compiled.detectors.length).toBeGreaterThan(0);
  expect(detectSensitiveValue('bob@example.com', compiled)).toBe(true);
});
// rrweb record suite
it('a plugin returning a malformed policy falls back to the user policy instead of throwing', () => {
  const badPlugin = { name: 'bad@1', applyPrivacyPolicy: () => ({ nonsense: true }) };
  expect(() =>
    record({ emit: () => {}, plugins: [badPlugin as never] }),
  ).not.toThrow();
});
it('untaintedTagName survives <form><input name="tagName">', () => {
  document.body.innerHTML = '<form><input name="tagName"></form>';
  expect(untaintedTagName(document.querySelector('form'))).toBe('FORM');
});
```

- [ ] **Step 2: Run, verify FAIL** (the malformed-plugin case throws today).
- [ ] **Step 3: Implement** the three changes; replace the raw `target.tagName.toLowerCase()` at `mutation.ts:665` and the inline typeof guard at `snapshot.ts:533-539` with `untaintedTagName(...)`; delete `nativeElementTagName`/`parentElementAcrossShadowRoot` from `privacy.ts`.
- [ ] **Step 4: Run** plugin + rrweb suites; verify PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(privacy): plugin compile fallback, shared untainted tagName, plugin detects under legacy"`

---

### Task 10: Types package, changeset, docs

**Files:**
- Modify: `packages/types/src/index.ts` (mirror Task 1 type removals for the public `@rrweb/types` copies; keep the `ImageBitmapDataURLWorkerParams` union but document it)
- Modify: `guide.md` (privacy section ~lines 270-300), `packages/plugins/rrweb-plugin-privacy-detectors/README.md`
- Create: `.changeset/privacy-v2-simplification.md`
- Test: `npx tsc -b tsconfig.json` (workspace type-check) as the verification step

**Interfaces:** none new; this task reconciles public types and docs with Tasks 1-9.

- [ ] **Step 1: Sync `packages/types`** with the rrweb-snapshot type changes (remove `PrivacyMaskStyle`, `custom` detectors, rule `style`/`classification`/`attributes`; preset union loses `'custom'`).
- [ ] **Step 2: Write the changeset:**

```md
---
'rrweb-snapshot': minor
'rrweb': minor
'@rrweb/types': major
'@rrweb/rrweb-plugin-privacy-detectors': minor
'@rrweb/utils': minor
---

Privacy at Capture v2: policies now compile onto rrweb's existing masking
primitives; heuristic detectors are a fixed whole-value set (custom regex
patterns removed); CSS is never masked; canvas masking forces the FPS capture
path; selector and config errors fail closed. BREAKING (@rrweb/types):
`ImageBitmapDataURLWorkerParams` is a union; privacy rule `style`,
`classification`, custom detectors, and the `'custom'` preset are removed.
```

- [ ] **Step 3: Update `guide.md`:** preset table now states exactly what Task 1 compiles (balanced: inputs + `title`/`placeholder`/`aria-label` + URL sanitization; strict: + all text, media blocked, canvas off; CSS never masked; detectors only via the plugin, active under any preset). Fix the line "Existing masking options are still applied when a policy does not make an explicit decision" to the Task 5 truth: "Under `balanced`/`strict`, `maskInputFn` output is star-replaced — the callback controls length, never content." Update plugin README per Task 9.
- [ ] **Step 4: Verify** — `npx tsc -b tsconfig.json` clean; `git grep -l "maskSensitiveRanges\|getPrivacyAction\|detectSensitiveText\|maskTextWithPrivacy\|maskAttributeWithPrivacy\|maskInputWithPrivacy\|shouldMaskInputWithPrivacy\|SAFE_GENERATED_ATTRIBUTES\|privacy-policy.schema"` returns nothing outside this plan/spec.
- [ ] **Step 5: Commit** — `git commit -am "docs(privacy): v2 types sync, changeset, guide"`

---

### Task 11: Full verification sweep

**Files:** none created; runs everything.

- [ ] **Step 1:** `npx yarn@1.22.19 install` if not yet done, then repo-root `npx turbo run test --filter=rrweb-snapshot --filter=rrweb --filter=@rrweb/rrweb-plugin-privacy-detectors --filter=@rrweb/utils` (fall back to per-package `npx vitest run` if turbo is unavailable). Expected: all green.
- [ ] **Step 2: Perf smoke** — add `packages/rrweb-snapshot/test/privacy-perf.test.ts`:

```ts
it('legacy snapshot performs no privacy selector matching', () => {
  const spy = vi.spyOn(Element.prototype, 'matches');
  document.body.innerHTML = '<div>'.repeat(200) + 'deep text' + '</div>'.repeat(200);
  snapshot(document, { privacy: compilePrivacyPolicy(undefined) });
  const privacyCalls = spy.mock.calls.filter(([sel]) =>
    typeof sel === 'string' && sel.includes('data-privacy'));
  expect(privacyCalls.length).toBe(0);
  spy.mockRestore();
});
```

- [ ] **Step 3:** Type-check (`npx tsc -b tsconfig.json`) and lint the touched packages (`npx turbo run lint --filter=...` if configured).
- [ ] **Step 4: Commit** — `git commit -am "test(privacy): perf smoke + full sweep"` — then report results (including any deviations) back for review before any push.

---

## Self-review notes

- Spec §1-§9 → Tasks 1-10 (coverage: §1→T1/T10, §2→T1, §3→T4/T7, §4→T5, §5→T3/T6, §6→T2/T9, §7→T8, §8→T9, §9 deletions distributed, §10→every task + T11).
- Type consistency: `CompiledPrivacyPolicy`, `CompiledDetector`, `finalizeAttribute`, `maskInput`, `needsMaskingText`, `untaintedTagName`, `resolveCanvasSampling` are each defined once in an Interfaces block and consumed by name in later tasks.
- Known judgment calls an implementer may hit: exact current line numbers may have drifted a few lines — anchor on symbol names, not line numbers; existing test harness names (`test/privacy.test.ts` structure) may require merging the new describes into existing files rather than replacing wholesale.
