---
"rrweb-snapshot": minor
"rrweb": minor
"@rrweb/types": major
"@rrweb/utils": minor
---

Privacy at Capture core: policies now compile onto rrweb's existing masking
primitives.

- BREAKING: `@rrweb/rrweb-plugin-privacy-detectors` and the
  `RecordPlugin.applyPrivacyPolicy` hook are removed (heuristic detectors
  return as an opt-in experimental layer in a follow-up change), several
  masking decisions that used to have inconsistent defaults are now always
  enforced (e.g. protected inputs, mask/unmask ties), and a few APIs change
  shape (`needMaskingText`,
  `CompiledPrivacyPolicy`) -- the default preset introduced by this change is
  named `minimal` -- see the guide's migration section for the full list.
  `needMaskingText`'s fail-closed catch now also logs a one-time
  `console.warn` naming the underlying error, instead of masking silently.
- Add an opt-in, versioned `privacyPolicy` with `strict`, `balanced`, and
  `minimal` presets, consistently protecting text, form values, and sensitive
  attributes across full snapshots and incremental mutations; existing rrweb
  masking options remain the backwards-compatible `minimal` default.
- Recognize the vendor-neutral `data-privacy="mask|block|unmask"` HTML
  binding directly in markup under `balanced`/`strict` -- the same three
  names as the rule actions, with any unrecognized value failing closed to
  `mask`; other tools' masking class names are recognized only under
  `vendorCompat: true`. Both are managed-preset features: under `minimal`,
  selector-based policy `rules` still work but compile to their bare
  selectors and switch nothing else on. An invalid selector is dropped per
  comma-separated fragment, so a malformed fragment no longer takes its
  valid siblings with it, even when the malformed fragment has a stray
  closing bracket or an unterminated quote. CSS is never masked, on any
  preset.
- Masked-attribute defaults (`title`/`placeholder`/`aria-label`) now resolve
  mask/unmask exactly like text: nearest annotated ancestor decides, mask
  wins a same-element tie, and a `record()`-level `maskTextSelector` takes
  part. Previously an unmask ancestor revealed those attributes through a
  nearer mask marker.
- `maskInputFn` and `maskTextFn` fail closed: a callback that throws or
  returns a non-string yields stars instead of aborting the snapshot or
  recording the raw value. An input whose `type` or `autocomplete` throws on
  read is treated as protected, and the `autocomplete` attribute is read
  before the IDL property so an unparseable token order cannot hide a
  `cc-number`.
- `vendorCompat` also recognizes `[data-sentry-block]` and FullStory's
  `.fs-mask-without-consent` / `.fs-exclude-without-consent`, and logs a
  one-time `console.warn` when set under `minimal`, where it has no effect.
- Add fail-closed `canvasMasking` region masking for complex canvas
  applications; configuring it forces the FPS capture path and suppresses
  the unmasked `rr_dataURL` full-snapshot fallback. `strict` disables canvas
  recording outright -- emitting no canvas events at all -- and an explicit
  `recordCanvas: true` now logs a one-time `console.warn` instead of being
  silently ignored. Canvases inside a shadow root are now discovered only
  through native shadow roots, so a polyfilled shadow root's canvases are no
  longer captured.
- Add coarse (`maskAllElementAttributes`) and callback-based
  (`maskAttributeFn`) final attribute-masking escape hatches. The guide's new
  "For event consumers" section documents what changes on the wire for
  anyone consuming the event stream directly: attributes may now come
  through as `null` (dropped), masked media sources become inline
  `data:image/svg+xml` placeholders, masked text stars non-whitespace only,
  a configured `canvasMasking` adapter emits periodic frame-image events
  (whereas `strict` emits none), and pages with a pre-existing
  `data-privacy` attribute of their own will have it read as rrweb's under
  managed presets.
