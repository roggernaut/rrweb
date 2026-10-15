# @rrweb/rrweb-plugin-privacy-detectors

## 2.2.0

### Minor Changes

- [`3b8004a`](https://github.com/rrweb-io/rrweb/commit/3b8004a0a60200afab8b0605e936e7fede35da7f) Thanks [@cursoragent](https://github.com/cursoragent)! - Move Highlight-style heuristic PII auto-detection out of `balanced`/`strict`
  defaults and into an opt-in `@rrweb/rrweb-plugin-privacy-detectors` plugin.
  Presets still mask form values and honor policy rules; email/phone/card/SSN/IP
  text matching is enabled only by the plugin or `applyPrivacyDetectors`.
