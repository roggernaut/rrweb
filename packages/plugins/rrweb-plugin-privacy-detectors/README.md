# @rrweb/rrweb-plugin-privacy-detectors

Opt-in Highlight-style heuristic PII matching for rrweb Privacy at Capture.

`balanced` and `strict` mask form values and honor `data-privacy` / policy
rules. They do **not** scan page text for emails, phones, cards, SSNs, or IP
addresses unless this plugin (or `applyPrivacyDetectors`) is used.

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
`maskTextFn` / `maskInputOptions` behavior) and only adds heuristic matching.

For snapshot-only use (no recorder):

```js
import { snapshot } from 'rrweb-snapshot';
import { applyPrivacyDetectors } from '@rrweb/rrweb-plugin-privacy-detectors';

snapshot(document, {
  privacyPolicy: applyPrivacyDetectors({ version: 1, preset: 'balanced' }),
});
```
