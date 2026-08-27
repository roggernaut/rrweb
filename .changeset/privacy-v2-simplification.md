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
- The vendor-neutral `data-privacy` attribute
  (`mask`/`exclude`/`allow`) is the standard way to declare privacy intent:
  it lives with the markup it protects, so it stays correct across template
  refactors and tool changes. Selector rules cover what the markup cannot
  reach. Recognition of other tools' class names is **migration
  compatibility** -- a page already instrumented for another recorder keeps
  its protection on day one -- and not the convention to adopt for new
  markup. Their mask/block tokens are honored because doing so can only
  increase masking; their unmask/allow tokens are never honored, because
  honoring one could reveal something the page author masked for a reason
  rrweb cannot know. The recognized cross-vendor unmask tokens are therefore
  just `.amp-unmask` and rrweb's own `.rr-unmask`;
  `.sentry-unmask`/`[data-sentry-unmask]` were removed, since no vendor
  defines them (Sentry's `unmask` default is `[]`). The mask and block class
  lists now cover eight vendors' conventions -- rrweb, Mixpanel, Amplitude,
  PostHog, Sentry, FullStory, Datadog, and New Relic.
- The preset's masked attributes (`title`, `placeholder`, `aria-label`) now
  honor the unmask selector -- whether it came from a policy `unmask`/`allow`
  rule, a recognized vendor class, or the `record()`-level
  `unmaskTextSelector` option, which is merged into the compiled policy so all
  three behave identically on both the snapshot and the mutation path. URL
  sanitization and `strict`'s media-source dropping are not escapable this
  way.
- Merged selector lists are now deduplicated, so the record()/snapshot()
  double-merge no longer repeats every fragment.
- The serializer's internal "generated attribute" masking exemption now
  requires the attribute name to be known rendering metadata (`rr_width`,
  `rr_height`, `rr_scrollLeft`, `rr_scrollTop`, `rr_mediaState`,
  `rr_open_mode`) as well as the flag, and the flag is cleared when a real
  page mutation writes that same attribute name.
- A second, sibling exemption now covers rrweb's own _page-present_
  operational attributes -- `data-privacy` and `data-rr-is-password` --
  which no masking branch may touch. The set is deliberately limited to
  names a code path actually reads back. Previously
  `maskAllElementAttributes` would star `data-privacy="mask"` out of the
  recording (erasing the declaration that explains why the surrounding
  subtree is masked) and star `data-rr-is-password`, breaking the replay-side
  password re-detection that reads it back. `maskAttributeFn` is no longer
  invoked for these names at all. This mirrors Datadog's carve-out for its own
  `data-dd-privacy`, `STABLE_ATTRIBUTES` and `actionNameAttribute`.
- Under `strict`, a blocked `<img>` `src`/`srcset` or `<video>` `poster` on an
  element that declares plain integer `width`/`height` attributes is now
  replaced by a neutral same-dimension SVG data URI instead of being dropped
  to `null`, so removing the pixels no longer collapses the layout around
  them. Dimensions come from the content attributes only -- never from
  `getBoundingClientRect`, which would force a layout flush per attribute --
  so an element with no usable declared dimensions still drops the attribute
  as before, as do all other media sources (`<iframe>`/`rr_src`, `<embed>`,
  `<object>`, `<audio>`, `<source>`).
- `sanitizeUrl` returns `null` rather than `''` for an unparseable URL, so
  the attribute is dropped instead of emptied -- an empty `src`/`href`
  re-resolves to the document URL at replay and gets requested.
- `canvasMasking` only forces the FPS canvas capture path when masking is
  actually in force; a provider whose `isConfigured()` returns `false` leaves
  `sampling.canvas` alone. `record()` also no longer mutates the `sampling`
  object it was passed, and no longer re-exports the internal
  `resolveCanvasSampling` helper.
- The mutation buffer now memoises `needMaskingText` decisions for the
  duration of a single synchronous flush, keyed by the element the ancestor
  walk starts from, so N `characterData` mutations sharing a parent cost one
  walk instead of N. Nothing is cached across flushes -- the DOM, and so every
  ancestor chain a decision came from, may change between them. Same
  granularity and same justification as Datadog's per-batch
  `nodePrivacyLevelCache`.
