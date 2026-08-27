---
"@rrweb/rrweb-plugin-privacy-detectors": minor
"rrweb": minor
"rrweb-snapshot": minor
"@rrweb/types": minor
---

Move heuristic PII auto-detection out of `balanced`/`strict`
defaults and into an opt-in `@rrweb/rrweb-plugin-privacy-detectors` plugin.
Presets still mask form values and honor policy rules; email/phone/card/SSN/IP
text matching is enabled only by the plugin or `applyPrivacyDetectors`.

Detection covers page text only. Input values are never scanned: while any
detector is active the compiled policy sets `maskAllInputs` regardless of
preset, so form values are occluded to their length instead.
