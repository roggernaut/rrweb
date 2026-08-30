---
"rrweb-snapshot": minor
"rrweb": minor
"@rrweb/types": major
"@rrweb/rrweb-plugin-privacy-detectors": minor
"@rrweb/utils": minor
---

Privacy at Capture: policies now compile onto rrweb's existing masking
primitives.

- BREAKING: `@rrweb/rrweb-plugin-privacy-detectors`'s API and the
  `RecordPlugin.applyPrivacyPolicy` hook are new, and several masking
  decisions that used to have inconsistent defaults are now always enforced
  (e.g. protected inputs, mask/unmask ties) -- the default preset introduced
  by this change is named `manual`, and recognizing another session-replay
  tool's privacy classes is opt-in via `vendorCompat: true` rather than a
  managed-preset default -- see the guide's migration section for the full
  list.
- Add an opt-in, versioned `privacyPolicy` with `strict`/`balanced`/`manual`
  presets, the vendor-neutral `data-privacy` HTML binding (`mask`/`block`/
  `unmask`, the same three names as the rule actions, with any unrecognized
  value failing closed to `mask`), fail-closed `canvasMasking`, and
  attribute-masking escape hatches; existing masking options remain the
  `manual` default.
- **Experimental:** opt-in heuristic PII detectors (email/phone/card/SSN/IP)
  via `@rrweb/rrweb-plugin-privacy-detectors`.
- **Experimental, no vendor precedent:** recorded-DOM URL sanitization under
  `balanced`/`strict`.
- **Experimental optimization:** an unmask-selector presence probe avoids
  the per-node ancestor walk `unmaskTextSelector` would otherwise force.
