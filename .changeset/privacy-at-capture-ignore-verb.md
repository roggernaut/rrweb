---
"rrweb-snapshot": minor
"rrweb": minor
"@rrweb/types": minor
---

`data-privacy="ignore"`: the fourth verb, mask plus event silence.

- An `ignore` subtree's content is masked exactly like `data-privacy="mask"`,
  and no input events are ever emitted for it -- not even length-only starred
  values.
- The verbs form a severity ladder `unmask < mask < ignore < block`; the
  nearest annotated ancestor decides, so a descendant `unmask` inside an
  `ignore` subtree re-enables both content and events, `block` remains
  absolute, and on one element the strictest verb present wins.
- `CompiledPrivacyPolicy` gains `ignoreSelector`, null under `minimal`, where
  `data-privacy` stays off entirely.
- The legacy `.rr-ignore`/`ignoreClass`/`ignoreSelector` controls are
  unchanged: per-element, input events only, never masking -- a noise
  control, not a privacy mechanism.
