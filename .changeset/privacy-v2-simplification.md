---
"rrweb-snapshot": minor
"rrweb": minor
"@rrweb/types": major
"@rrweb/rrweb-plugin-privacy-detectors": minor
"@rrweb/utils": minor
---

Privacy at Capture v2: policies now compile onto rrweb's existing masking
primitives; heuristic detectors are a fixed whole-value set (custom regex
patterns removed); CSS is never masked; canvas masking forces the FPS capture
path; selector and config errors fail closed. BREAKING (@rrweb/types):
`ImageBitmapDataURLWorkerParams` is a union; privacy rule `style`,
`classification`, custom detectors, and the `'custom'` preset are removed.

Additional breaking/behavior notes:

- `needMaskingText` (exported from `rrweb-snapshot`) gained parameters; old
  positional callers break.
- `<style>` text inside masked subtrees is no longer masked on any path,
  including `characterData` mutations -- this is deliberate: CSS is never
  masked.
- Heuristic detection now masks whole values -- there is no more
  character-range `'xxxx'`-shape masking. It scans page text nodes and form
  input values, both at snapshot time and on live updates (`characterData`
  mutations and input events), whenever the value would otherwise be recorded
  unmasked. Attribute values are not scanned.
- `maskInputFn`/`maskAttributeFn` outputs are constrained under
  `balanced`/`strict`: `maskInputFn` output is star-replaced (the callback
  controls length, never content), and `maskAttributeFn` output is
  policy-final (the compiled policy can still narrow, but never restore,
  what the callback chose to keep).
- `maskAllElementAttributes` and `maskAttributeFn` are now mutually
  exclusive: when both are supplied, `maskAllElementAttributes` wins and
  `maskAttributeFn` is ignored with a one-time console warning.
- Protected inputs -- `password`, `hidden`, `data-rr-is-password`, and
  autocomplete `cc-*`/`current-password`/`new-password`/`one-time-code` --
  are now **always** masked, with no `privacyPolicy` required and regardless
  of `maskInputOptions`. Previously `hidden` inputs and autocomplete-tagged
  credit-card/password/OTP fields could record their raw value under
  `legacy`; they cannot anymore.
- An invalid `maskTextSelector`/`unmaskTextSelector` (including the plain
  `record()`-level string options, not just policy `rules`) now fails closed
  -- the bad selector throws inside the mask decision, which is caught and
  masks the text -- instead of being silently ignored as if it had never been
  set.
