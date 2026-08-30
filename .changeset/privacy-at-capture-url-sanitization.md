---
"rrweb": minor
"rrweb-snapshot": minor
"@rrweb/types": minor
---

Privacy at Capture: recorded-DOM URL sanitization (**experimental** -- no
vendor precedent, review this hardest).

- Under `balanced`/`strict`, every URL-bearing attribute the serializer emits
  and the Meta event's `href` go through `sanitizeUrl`: userinfo is
  stripped, sensitive query parameter values are replaced with `*`
  (`url.blockedQueryParameters` plus a default list), and the hash is
  removed unless `url.removeHash: false`. `strict` blocks every parameter
  value unless `url.allowedQueryParameters` names it.
- **EXPERIMENTAL, open design question for upstream:** the Meta event's
  `href` (via the new `sanitizeMetaUrl`) is scoped like `balanced` even
  under `strict` -- masking only blocked-list parameters -- because it is
  the recording's own address, not page-author markup; every DOM URL
  attribute keeps `strict`'s normal mask-everything-unless-allowlisted
  treatment.
- An unparseable URL fails closed: the attribute is dropped (`null`) rather
  than emptied, since an empty `src`/`href` re-resolves to the document URL
  at replay.
- The unmask escape cannot reopen a sanitized URL.
- Rebased onto the renamed rule actions (`mask`/`block`/`unmask`) and the
  opt-in `vendorCompat` flag; URL sanitization itself keys off the managed
  presets and is unaffected by either.
