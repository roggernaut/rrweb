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
  (e.g. protected inputs, mask/unmask ties, foreign unmask tokens never
  honored) -- the default preset introduced by this change is named `manual`
  -- see the guide's migration section for the full list.
- Add an opt-in, versioned `privacyPolicy` with `strict`/`balanced`/`manual`
  presets, the vendor-neutral `data-privacy` HTML binding, fail-closed
  `canvasMasking`, and attribute-masking escape hatches; existing masking
  options remain the `manual` default.
- **Experimental:** opt-in heuristic PII detectors (email/phone/card/SSN/IP)
  via `@rrweb/rrweb-plugin-privacy-detectors`.
- **Experimental, no vendor precedent:** recorded-DOM URL sanitization under
  `balanced`/`strict`.
- **Experimental optimization:** an unmask-selector presence probe avoids
  the per-node ancestor walk `unmaskTextSelector` would otherwise force.
