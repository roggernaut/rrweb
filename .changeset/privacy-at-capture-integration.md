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
  list. `vendorCompat` can only ever increase masking or blocking, never
  reveal: no foreign tool's unmask convention is ever honored, on either
  setting. `needMaskingText`'s fail-closed catch and an explicit
  `recordCanvas: true` under `strict` each log a one-time `console.warn`
  instead of failing silently.
- Add an opt-in, versioned `privacyPolicy` with `strict`/`balanced`/`manual`
  presets, the vendor-neutral `data-privacy` HTML binding (`mask`/`block`/
  `unmask`, the same three names as the rule actions, with any unrecognized
  value failing closed to `mask`), fail-closed `canvasMasking`, and
  attribute-masking escape hatches; existing masking options remain the
  `manual` default. The guide's new "For event consumers" section documents
  what changes on the wire for anyone consuming the event stream directly
  (nullable attributes, SVG media placeholders, starred text, canvas
  keyframes, and the `data-privacy` collision with pre-existing attributes).
- **Experimental:** opt-in heuristic PII detectors (email/phone/card/SSN/IP)
  via `@rrweb/rrweb-plugin-privacy-detectors`, which logs a one-time
  `console.info` the first time it applies its policy.
- **Experimental, no vendor precedent:** recorded-DOM URL sanitization under
  `balanced`/`strict`. **Open design question for upstream:** the Meta
  event's own `href` is scoped like `balanced` (blocked-list-only param
  masking) even under `strict`, since it is the recording's own address
  rather than page-author markup; every DOM URL attribute keeps `strict`'s
  normal mask-everything-unless-allowlisted treatment.
- **Experimental optimization:** an unmask-selector presence probe avoids
  the per-node ancestor walk `unmaskTextSelector` would otherwise force.
