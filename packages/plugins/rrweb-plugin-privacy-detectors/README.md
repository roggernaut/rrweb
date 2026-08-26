# @rrweb/rrweb-plugin-privacy-detectors

Opt-in Highlight-style heuristic PII matching for rrweb Privacy at Capture:
whole-value masking of page text nodes at snapshot time when a detector
matches (email, phone, Luhn-valid payment card, SSN-like, IPv4). Detection
does not currently scan input values, attribute values, or later live text
mutations.

No privacy preset implies detection on its own. `balanced` and `strict` mask
form values and honor `data-privacy` / policy rules, but neither one scans
page text or input values for emails, phones, cards, SSNs, or IP addresses
unless this plugin (or `applyPrivacyDetectors`) is used.

## Installation

```bash
npm install @rrweb/rrweb-plugin-privacy-detectors
```

## Usage

```js
import { record } from '@rrweb/record';
import { getRecordPrivacyDetectorsPlugin } from '@rrweb/rrweb-plugin-privacy-detectors';

record({
  emit(event) {
    // store event
  },
  privacyPolicy: {
    version: 1,
    preset: 'balanced',
  },
  plugins: [
    getRecordPrivacyDetectorsPlugin(),
    // or disable one class of match:
    // getRecordPrivacyDetectorsPlugin({ ipAddress: false }),
  ],
});
```

If `privacyPolicy` is omitted, the plugin keeps the `legacy` preset (existing
`maskTextFn` / `maskInputOptions` behavior) -- and still detects: detection is
independent of preset, so a bare `record({ plugins: [getRecordPrivacyDetectorsPlugin()] })`
with no `privacyPolicy` at all masks any page text node a detector matches at
snapshot time, on top of whatever `maskTextFn` / `maskInputOptions` already do.

For snapshot-only use (no recorder):

```js
import { snapshot } from 'rrweb-snapshot';
import { applyPrivacyDetectors } from '@rrweb/rrweb-plugin-privacy-detectors';

snapshot(document, {
  privacyPolicy: applyPrivacyDetectors({ version: 1, preset: 'balanced' }),
});
```
