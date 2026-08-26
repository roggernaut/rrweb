---
'rrweb-snapshot': minor
'rrweb': minor
'@rrweb/types': major
'@rrweb/rrweb-plugin-privacy-detectors': minor
'@rrweb/utils': minor
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
- Heuristic detection now masks whole text nodes at snapshot time -- there is
  no more character-range `'xxxx'`-shape masking. (It does not scan input
  values, attribute values, or later live text mutations.)
- `maskInputFn`/`maskAttributeFn` outputs are constrained under
  `balanced`/`strict`: `maskInputFn` output is star-replaced (the callback
  controls length, never content), and `maskAttributeFn` output is
  policy-final (the compiled policy can still narrow, but never restore,
  what the callback chose to keep).
- `maskAllElementAttributes` and `maskAttributeFn` are now mutually
  exclusive: when both are supplied, `maskAllElementAttributes` wins and
  `maskAttributeFn` is ignored with a one-time console warning.
