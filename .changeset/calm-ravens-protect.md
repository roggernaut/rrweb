---
"rrweb": minor
"rrweb-snapshot": minor
---

Add an opt-in, versioned `privacyPolicy` with `strict`, `balanced`, and
`legacy` presets. Compiled policies consistently protect text, form values,
sensitive attributes (`title`, `placeholder`, `aria-label`), and URLs across
full snapshots and incremental mutations, while the existing rrweb masking
options remain the backwards-compatible `legacy` default. CSS is never
masked, on any preset. Under `balanced`/`strict`, the vendor-neutral
`data-privacy="exclude|mask|allow"` HTML binding and common cross-vendor
masking class names are recognized directly in markup; selector-based policy
`rules` work under every preset, including `legacy`. Add fail-closed
`canvasMasking` region masking for complex canvas applications (configuring
it forces the FPS capture path and suppresses the unmasked `rr_dataURL`
full-snapshot still), plus coarse (`maskAllElementAttributes`) and
callback-based (`maskAttributeFn`) final attribute masking escape hatches.
