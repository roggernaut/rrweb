---
"rrweb-snapshot": minor
"@rrweb/types": minor
---

Granular `vendorCompat`: pick the vendors whose conventions to honor.

- `vendorCompat` now also accepts an array of vendor ids (`'mixpanel'`,
  `'posthog'`, `'datadog'`, ...), merging only the named vendors' mask/block
  tokens; `true` still merges every verified vendor and `[]` merges none.
- An unknown id in the array is dropped with a `console.warn` naming it.
- The invariant is unchanged and holds for every form of the setting: no
  vendor's unmask/allow or input-ignore token is ever merged.
