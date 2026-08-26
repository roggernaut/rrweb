---
"rrweb": patch
"rrweb-snapshot": patch
---

Privacy at Capture: unmask-selector presence probe (**experimental**
optimization -- novel, no vendor precedent).

- Add `resolveUnmaskTextSelector`: probes once per snapshot/mutation flush
  (not per node) whether `unmaskTextSelector` currently matches anything in
  the document, including open shadow roots. When it matches nothing, the
  cheap masking short-circuit is restored for that pass; a selector that
  throws is assumed present, so behavior fails closed.
- Pair it with per-flush/per-snapshot memoisation of `needMaskingText`
  decisions (keyed by the ancestor-walk's starting element), so mutations or
  siblings sharing a parent share one walk instead of paying for one each.
- On a 40-deep x 40-wide DOM under `strict` with no unmask target, total
  `matches()` calls drop from thousands to under 200.
- Rebased onto the renamed rule actions and the opt-in `vendorCompat` flag.
  The probe shrinks with the unmask list: with `vendorCompat` off, only
  `[data-privacy="unmask"]`, `.rr-unmask`, and explicit selectors keep it
  from short-circuiting.
