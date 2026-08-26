# Privacy at Capture v2 — Simplification Design

**Date:** 2026-08-25
**Status:** Approved (design), pending implementation plan
**Branch:** `privacy-v2-simplification` (off `main` @ `41c22825`)

## Context

The Privacy at Capture feature (merged via PR #1, `37a946a5..main`) introduced a
versioned privacy policy, selector rules, heuristic PII detectors with
user-supplied regex patterns, canvas masking, and URL sanitization. A
high-effort code review confirmed 24 defects, including silent privacy leaks
(canvas command stream, detector candidate skipping, URL credentials, plugin
no-op), fail-open selector handling, a bypassable ReDoS validator, CSS
destruction under `strict`, and a default-path performance regression from an
uncached per-node ancestor-walk engine.

A source-level survey of the five major session-replay vendors built on rrweb
(PostHog, Highlight, Sentry, Amplitude, Mixpanel) showed the confirmed bugs
cluster exactly where this feature diverges from field-proven practice:
sub-range regex masking of DOM text and user-supplied detector patterns, which
no vendor ships.

**Goal:** an upstreamable privacy layer that vendors can adopt in place of
their forks and wrapper layers, maintained by the community.

## Governing principles

1. **Fail closed.** Every ambiguity — invalid config, thrown exception,
   unreachable mask path — resolves toward masking or not capturing.
2. **Proven mechanisms only.** No mechanism ships that no vendor has run in
   production. Where vendors disagree, adopt the safest variant.
3. **Legacy is sacred.** With no `privacyPolicy` and no privacy plugin
   loaded, behavior and performance are byte-identical to rrweb before this
   feature. (Loading the detectors plugin is an explicit opt-in and does
   change behavior — see §6.) Two sanctioned exceptions, both required by
   principle 1 (fail closed) and neither gated behind `privacyPolicy`:
   - **Protected inputs always masked.** `password`/`hidden` inputs and
     autocomplete `cc-*`/`current-password`/`new-password`/`one-time-code`
     fields are masked unconditionally, with no `privacyPolicy` required and
     regardless of `maskInputOptions`. Pre-v2 `legacy` behavior let `hidden`
     inputs and autocomplete-tagged card/password/OTP fields record raw --
     that gap is intentionally closed, not preserved.
   - **Invalid selectors fail closed.** An invalid `maskTextSelector`/
     `unmaskTextSelector` -- the plain `record()`-level string option or a
     policy rule's selector -- throws inside the mask decision and is caught
     as a mask, not silently ignored as if unset.

## Decisions (approved)

- **Detectors:** fixed set only (email, phone, Luhn card, SSN, IPv4), each
  individually toggleable. **No user-supplied regex patterns.** Any hit masks
  the **whole text node / input value**, not character ranges (Highlight
  model). Pattern set is derived from PostHog's network-side patterns
  (delimited digit runs, Luhn validation, SSN invalid-group exclusions), not
  Highlight's (which contain unescaped-dot bugs).
- **Architecture:** `compilePrivacyPolicy` compiles presets and rules down
  onto rrweb's **existing masking primitives** (`maskTextSelector`,
  `maskAllInputs`, `maskInputOptions`, `blockSelector`, inherited `needsMask`
  propagation), extended minimally. The parallel `getPrivacyAction`
  ancestor-walk engine is **deleted**.

## Design

### 1. Policy surface

```ts
privacyPolicy: {
  version: 1,
  preset: 'legacy' | 'balanced' | 'strict',
  rules?: { selector: string; action: 'mask' | 'unmask' | 'exclude' | 'allow' }[],
  blockedQueryParameters?: string[],
  allowedQueryParameters?: string[],
}
```

Removed from the schema: custom detector patterns, `minimumLength`,
`maximumMatchLength`, `maskStyle`, `classification` (dead or dangerous per
review). The `privacy-policy.schema.json` file is **deleted**; TypeScript
types plus runtime validation are the single source of truth (fixes the
three-way schema/types/runtime drift that let schema-valid policies crash
`record()`).

### 2. Compilation

`compilePrivacyPolicy(policy)` returns a bundle of existing rrweb options plus
merged selector lists. No rule engine.

- `legacy` → exactly today's defaults. Zero added cost on the default path.
- `balanced` → `maskAllInputs: true`, `maskInputOptions.password: true`
  **forced regardless of user config** (PostHog), masked attributes
  `['title', 'placeholder', 'aria-label']` (Sentry's default list), URL
  sanitization on.
- `strict` → balanced + `maskTextSelector: '*'` (mask-all-text posture,
  Sentry/Mixpanel), media blocking (`img, video, audio, source`, Sentry's
  `blockAllMedia`), `recordCanvas` forced off, URL sanitization.
- Rules and the three `data-privacy` attribute selectors compile into the
  mask / unmask / block selector lists.
- Cross-vendor mask classes recognized in compiled defaults:
  `.rr-mask, .mp-mask, .fs-mask, .amp-mask, .ph-mask` and block equivalents
  (Mixpanel precedent) — eases vendor adoption of upstream.
- **Per-selector validation at compile:** each selector is probed with
  `fragment.querySelector(sel)` in try/catch (Amplitude); invalid selectors
  are dropped with a `console.warn` naming the selector. A selector is never
  merged unvalidated, so one bad selector cannot poison the merged list.
- Error handling: a user-supplied invalid policy throws at `record()` call
  time (programmer error, matches rrweb conventions). A **plugin-transformed**
  policy that fails to compile falls back to compiling the user's own policy,
  with `console.error`.

### 3. Text and CSS

- The single decision channel is the existing inherited `needsMask`
  propagation (checked once at subtree root, short-circuits for descendants —
  PostHog's tri-state mechanism is the reference).
- `unmaskTextSelector` is added to the core `needsMask` check,
  nearest-ancestor-wins (Sentry's `maskDistance <= unmaskDistance` tie-break).
- CSS is **never masked** (unanimous vendor precedent): the `!isStyle`
  exemption applies to all paths, including mutation/characterData (fixing
  the inconsistency Sentry's own fork still has).
- `maskTextFn` composition unchanged under `legacy`.

### 4. Inputs

- All input masking routes through `maskInputValue` + `maskInputOptions`;
  presets set the options.
- `legacy`: `maskInputFn` behaves exactly as today.
- `balanced`/`strict`: defense-in-depth (Sentry): the user fn runs, then its
  output is star-replaced — the fn controls length, never content. Neither
  the preset nor the fn can silently weaken the other.

### 5. Attributes and URLs

- **One** attribute finalization pass in one shared helper, used by both
  `serializeElementNode` and the mutation emit path (deletes the snapshot
  double-masking; mutation-added nodes stop bypassing
  `maskAllElementAttributes`/`maskAttributeFn`).
- The four copy-pasted `legacyMask` forks collapse into that helper.
- `style`/`_cssText` are removed from `SENSITIVE_ATTRIBUTES`.
- `maskAllElementAttributes` and `maskAttributeFn` are mutually exclusive;
  the fn is dropped with a warning (PostHog fail-closed rationale).
- Generated-attribute safety: trust the serializer's own `isGenerated` flag;
  delete the `SAFE_GENERATED_ATTRIBUTES` static list, the per-element Set
  bookkeeping, and mutation.ts's `generatedAttributes` WeakMap.
- `sanitizeUrl`: additionally clears `url.username`/`url.password`
  (ahead of all five vendors); lowercased blocked/allowed sets precomputed at
  compile time.

### 6. Detectors plugin (`@rrweb/rrweb-plugin-privacy-detectors`)

- Fixed detectors: email, phone, Luhn payment card, SSN, IPv4. Per-detector
  boolean toggles only.
- Scan is `regex.test(value)` per enabled detector with short-circuit; any
  hit masks the **entire** text node or input value through the same masking
  path as everything else. `mergeMatches`, `maskSensitiveRanges`,
  `SensitiveMatch`, `scanCustomPattern`, and `validateCustomDetector` are
  deleted.
- Detection runs **independent of preset early-returns**: loading the plugin
  with no `privacyPolicy` detects under `legacy` (fixes the silent no-op;
  makes the plugin README true).
- Patterns are bounded/linear (audited); Luhn for cards, invalid-group
  exclusions for SSN (`(?!000|666)…`), delimiter-aware digit runs to avoid
  the UUID/long-number false-positive classes PostHog documents.

### 7. Canvas

- Fail closed: when `canvasMasking` is configured, canvas is captured only
  via the FPS/worker path where mask regions apply. If `sampling.canvas` is
  not numeric, it is forced to a low default (with a `console.warn`) instead
  of letting the unmasked mutation-mode command stream run.
- Mask region scaling uses content-box math (`getBoundingClientRect` minus
  padding/border), not `clientWidth`; a hidden canvas (0 dimensions) skips
  capture rather than assuming backing-store coordinates.
- `strict` keeps `recordCanvas` forced off.

### 8. Hardening

- Mask-decision paths are wrapped fail-closed (Mixpanel): decision variable
  initialized to *masked*; any throw logs and masks.
- One untainted `tagName` accessor in `@rrweb/utils`
  (`getUntaintedAccessor('Element', el, 'tagName')`) replaces the two
  divergent one-off shadowing fixes and is used at every `tagName` read in
  privacy-relevant paths. Same for the shadow-root walk (`isShadowRoot` +
  `dom.host`) and password detection (`getInputType`).
- `ImageBitmapDataURLWorkerParams` union change is declared in the changeset
  as a breaking change to `@rrweb/types`.

### 9. Deletions summary

`getPrivacyAction` engine and all call sites; range-masking machinery;
custom-pattern validator; `maskStyle`/`classification`/`MASK_STYLES`;
`privacy-policy.schema.json`; `SAFE_GENERATED_ATTRIBUTES` dual mechanism;
`generatedAttributes` WeakMap; duplicated CSS-mask helpers
(`maskAdoptedRule` folds into shared `maskCssForRecord`); the four
`legacyMask` copy-paste forks. Expected: `privacy.ts` shrinks from ~936 to
roughly ~300 lines; all 10 reported review findings and the overflow items
are resolved structurally.

### 10. Testing

- Existing privacy/detector/recorder suites adapted to the new shapes.
- New regression tests pinning each confirmed failure mode:
  - Detector adjacency: `call 5551234567 4111 1111 1111 1111 now` → node
    masked (was: Visa in cleartext).
  - Invalid selector in a rule → dropped with warning; other selectors still
    enforced; blocked elements stay blocked.
  - `<style>` text inside a masked subtree → unmasked CSS (legacy and strict).
  - `strict` → inline `style` and `_cssText` intact.
  - `maskInputFn` + `balanced` → star-replaced output, never raw fn output,
    never shape-preserving digit leaks.
  - `canvasMasking` + default sampling → no mutation-mode canvas events;
    FPS path active with masks applied.
  - Plugin with no policy → detectors active (README contract).
  - URL userinfo stripped under balanced/strict.
  - Compile snapshots: preset → options bundle (guards behavioral drift).
- Perf smoke: full snapshot of a deep DOM with no policy performs zero
  selector matches attributable to privacy (engine deleted).

## Appendix: prior art per adopted mechanism

| Mechanism adopted | Vendor source (file refs as of 2026-08 clones) |
|---|---|
| Whole-node masking on detector hit | Highlight fork `rrweb-snapshot/src/snapshot.ts:555-578` (`obfuscateText` on `.test()` hit) |
| No user-supplied detector regexes | All five vendors (none ship one) |
| Card/SSN pattern set + Luhn | posthog-js `browser-common/src/utils/autocapture-utils.ts:518-638` |
| Per-selector validation, drop + warn | Amplitude `session-replay-browser/src/config/joined-config.ts:24` (`removeInvalidSelectorsFromPrivacyConfig`) |
| Fail-closed mask decision (init masked, catch masks) | mixpanel-js `src/recorder/session-recording.js:588` (`_getMaskFn`) |
| Fail-closed under mask-all (catch returns masked) | Sentry fork `rrweb-snapshot/src/snapshot.ts:512-516` (`needMaskingText`) |
| `maskInputFn` output star-replaced (fn controls length only) | Sentry fork `rrweb-snapshot/src/utils.ts:274-296` (`maskInputValue`) |
| Forced `password: true` over user config | posthog-js `lazy-loaded-session-recorder.ts:2555` |
| `maskAttributeFn` dropped under `maskAllElementAttributes` | posthog-js `lazy-loaded-session-recorder.ts:2621-2633` |
| Masked attribute defaults (`title`, `placeholder`, `aria-label`) | Sentry `replay-internal/src/integration.ts:142` |
| Inherited mask propagation, checked once per subtree | posthog-js fork `rrweb-snapshot/src/snapshot.ts:1284-1292, 327-340` (tri-state `needsMask`); Highlight fork `snapshot.ts:1142-1150` (`overwrittenPrivacySetting`) |
| Nearest-ancestor mask/unmask tie-break | Sentry fork `rrweb-snapshot/src/snapshot.ts:505-511` |
| CSS/script never masked | Highlight fork `snapshot.ts:565-576` (`IGNORE_TAG_NAMES`); Sentry fork `snapshot.ts:765-805` (`!isStyle` guard) |
| Mask-all-text `strict` posture | Sentry `integration.ts:125-126`; mixpanel-js `session-recording.js:308-310` |
| Cross-vendor mask/block class recognition | mixpanel-js `src/recorder/masking.js` (`.mp-mask, .fs-mask, .amp-mask, .rr-mask, .ph-mask`) |
| Canvas fail-closed when masking configured | posthog-js `lazy-loaded-session-recorder.ts:2596-2610` (regions fn throw → frame dropped); Amplitude hard-off precedent `session-replay.ts:1078` |
| Forced autocomplete `cc-*`/`current-password` masking | Sentry fork `rrweb-snapshot/src/snapshot.ts:452-468` |

Known vendor defects deliberately **not** adopted: Highlight's unescaped-dot
regexes; Sentry's missing style exemption on the characterData path and
uncached per-node walks; PostHog's fail-open invalid `maskTextSelector` and
out-of-try/catch `blockSelector` match; Mixpanel's raw `blockSelector`
passthrough; Amplitude's warn-only loss of mask coverage on invalid mask
selectors.

## Findings resolution map

| Review finding | Resolved by section |
|---|---|
| canvasMasking ignored by mutation-mode capture | §7 |
| ReDoS validator bypass | §6 (no user patterns) |
| Failed detector candidate skips real PII | §6 (whole-node) |
| maskInputFn ignored under presets | §4 |
| Plugin silent no-op | §6 |
| URL userinfo recorded | §5 |
| Invalid selector poisons blockSelector | §2 |
| Added nodes skip attribute masking | §5 |
| strict destroys CSS | §3, §5 |
| `<style>` text masked in masked subtrees | §3 |
| Zero-width flood, mask-scale, plugin-crash, schema-drift, types-break | §6, §7, §2, §1, §8 |
| Perf: walks, double-mask, QSA-per-tick, per-call Sets | §2, §3, §5, §7 |
| Cleanup: legacyMask forks, gen-attr dual, CSS choke, dup helpers | §5, §8, §9 |
