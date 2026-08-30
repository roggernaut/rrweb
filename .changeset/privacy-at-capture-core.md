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
  named `manual` -- see the guide's migration section for the full list.
  `needMaskingText`'s fail-closed catch now also logs a one-time
  `console.warn` naming the underlying error, instead of masking silently.
- Add an opt-in, versioned `privacyPolicy` with `strict`, `balanced`, and
  `manual` presets, consistently protecting text, form values, and sensitive
  attributes across full snapshots and incremental mutations; existing rrweb
  masking options remain the backwards-compatible `manual` default.
- Recognize the vendor-neutral `data-privacy="mask|block|unmask"` HTML
  binding directly in markup under `balanced`/`strict` -- the same three
  names as the rule actions, with any unrecognized value failing closed to
  `mask`; other tools' masking class names are recognized only under
  `vendorCompat: true`. Selector-based policy `rules` work under every
  preset, including `manual`. CSS is never masked, on any preset.
- Add fail-closed `canvasMasking` region masking for complex canvas
  applications; configuring it forces the FPS capture path and suppresses
  the unmasked `rr_dataURL` full-snapshot fallback. `strict` disables canvas
  recording outright; an explicit `recordCanvas: true` now logs a one-time
  `console.warn` instead of being silently ignored.
- Add coarse (`maskAllElementAttributes`) and callback-based
  (`maskAttributeFn`) final attribute-masking escape hatches. The guide's new
  "For event consumers" section documents what changes on the wire for
  anyone consuming the event stream directly: attributes may now come
  through as `null` (dropped), masked media sources become inline
  `data:image/svg+xml` placeholders, masked text stars non-whitespace only,
  masked canvas emits periodic frame-image events, and pages with a
  pre-existing `data-privacy` attribute of their own will have it read as
  rrweb's under managed presets.
