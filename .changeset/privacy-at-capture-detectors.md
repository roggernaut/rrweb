---
"@rrweb/rrweb-plugin-privacy-detectors": minor
"rrweb": minor
"rrweb-snapshot": minor
"@rrweb/types": minor
---

Privacy at Capture: opt-in heuristic PII detectors (**experimental** -- no
production mileage in any shipped session-replay recorder).

- Add `@rrweb/rrweb-plugin-privacy-detectors` (email, phone, Luhn-valid card,
  SSN-like, IPv4): masks a whole page text node on match, at snapshot time
  and on live `characterData` mutations. Never implied by a preset; opt in
  via the plugin or `applyPrivacyDetectors`. Attribute values and custom
  detector patterns are not supported.
- While any detector is active, every input value is occluded to its length
  regardless of preset (no unmask escape reopens one) -- scanning a value as
  typed would leak it through keystroke prefixes.
- Add the `RecordPlugin.applyPrivacyPolicy` hook so a plugin can transform
  the policy before `record()` compiles it; see the plugin's README for known
  limitations.
- Rebased onto the renamed rule actions: a policy handed to
  `applyPrivacyDetectors` or the plugin uses `mask`/`block`/`unmask`, and
  `vendorCompat` is carried through untouched.
