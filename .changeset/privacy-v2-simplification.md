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
- An invalid `maskTextSelector`/`unmaskTextSelector`/`blockSelector`
  (including the plain `record()`-level string options, not just policy
  `rules`) is now validated at setup and **dropped with a `console.warn`**,
  the same treatment policy rule selectors already got, instead of being
  silently ignored as if it had never been set. Dropping it individually is
  what keeps one malformed selector from making every later `matches()` throw
  and starring the whole page. A selector that passes validation but throws
  while matching still fails closed to masking.
- Same-element mask/unmask ties now resolve to **masking**. An element
  matching both a mask source (`maskTextClass`, a `mask` rule, a vendor mask
  class) and the unmask selector is masked; previously unmask won. The
  nearest-matching-ancestor rule across different levels is unchanged.
- The recognized cross-vendor unmask tokens are now `.amp-unmask` and
  rrweb's own `.rr-unmask`. `.sentry-unmask`/`[data-sentry-unmask]` were
  removed: no vendor defines them (Sentry's `unmask` default is `[]`). The
  mask and block class lists are unchanged.
- The preset's masked attributes (`title`, `placeholder`, `aria-label`) now
  honor the unmask selector: an element inside an unmask subtree keeps them.
  URL sanitization and `strict`'s media-source dropping are not escapable
  this way.
- The serializer's internal "generated attribute" masking exemption now
  requires the attribute name to be known rendering metadata (`rr_width`,
  `rr_height`, `rr_scrollLeft`, `rr_scrollTop`, `rr_mediaState`,
  `rr_open_mode`) as well as the flag, and the flag is cleared when a real
  page mutation writes that same attribute name.
- `sanitizeUrl` returns `null` rather than `''` for an unparseable URL, so
  the attribute is dropped instead of emptied -- an empty `src`/`href`
  re-resolves to the document URL at replay and gets requested.
- `canvasMasking` only forces the FPS canvas capture path when masking is
  actually in force; a provider whose `isConfigured()` returns `false` leaves
  `sampling.canvas` alone. `record()` also no longer mutates the `sampling`
  object it was passed, and no longer re-exports the internal
  `resolveCanvasSampling` helper.
