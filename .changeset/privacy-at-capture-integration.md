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
  by this change is named `minimal`, and recognizing another session-replay
  tool's privacy classes is opt-in via `vendorCompat` rather than a
  managed-preset default -- see the guide's migration section for the full
  list. It covers the verified mask/block conventions of twenty-five
  session-replay tools (each token sourced in the guide's "Vendor class
  recognition" table), taking `true` for every vendor or an array of vendor
  ids for just the named ones (an unknown id is dropped with a `console.warn`
  naming it), and can only ever increase masking or blocking, never reveal:
  no foreign tool's unmask or input-ignore convention is ever honored, under
  any form of the setting. `needMaskingText`'s fail-closed catch and an explicit
  `recordCanvas: true` under `strict` each log a one-time `console.warn`
  instead of failing silently.
- Add an opt-in, versioned `privacyPolicy` with `strict`/`balanced`/`minimal`
  presets, the vendor-neutral `data-privacy` HTML binding (the severity
  ladder `unmask` < `mask` < `ignore` < `block`, nearest annotated ancestor
  deciding, with any unrecognized value failing closed to `mask`; `ignore`
  masks like `mask` and additionally emits no input events for the subtree
  at all, unlike the legacy events-only, per-element `.rr-ignore`),
  fail-closed `canvasMasking`, and
  attribute-masking escape hatches; existing masking options remain the
  `minimal` default. Every masking callback fails closed: one that throws or
  returns a non-string yields stars, and an input whose `type`/`autocomplete`
  cannot be read is treated as protected. `data-privacy` and the `rr-*` classes are managed-preset
  features: under `minimal` a rule compiles to its bare selector and switches
  nothing else on. The guide's new "For event consumers" section documents
  what changes on the wire for anyone consuming the event stream directly
  (nullable attributes, SVG media placeholders, starred text, the
  `data-privacy` collision with pre-existing attributes, canvas keyframes
  under a `canvasMasking` adapter -- `strict` emits no canvas events at all
  -- and canvas-in-shadow-DOM discovery now requiring a native shadow root,
  so polyfilled shadow canvases are no longer captured).
- **Experimental:** opt-in heuristic PII detectors (email/phone/card/SSN/IP)
  via `@rrweb/rrweb-plugin-privacy-detectors`, which logs a one-time
  `console.info` the first time it applies its policy.
- **Experimental, no vendor precedent:** recorded-DOM URL sanitization under
  `balanced`/`strict`. **Open design question for upstream:** the Meta
  event's own `href` is scoped like `balanced` (blocked-list-only param
  masking) even under `strict`, since it is the recording's own address
  rather than page-author markup; every DOM URL attribute keeps `strict`'s
  normal mask-everything-unless-allowlisted treatment. A relative URL in an
  attribute rrweb does not already absolutify (`<form action>`,
  `<video poster>`, ...) is rewritten root-relative.
- **Experimental optimization:** an unmask-selector presence probe avoids
  the per-node ancestor walk `unmaskTextSelector` would otherwise force. The
  probe costs one full-document element sweep per flush precisely when no
  unmask target exists, scaling with DOM size.
