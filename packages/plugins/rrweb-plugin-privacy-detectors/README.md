# @rrweb/rrweb-plugin-privacy-detectors

Opt-in heuristic PII matching for rrweb Privacy at Capture — inspired by the
automatic PII redaction found in commercial session-replay tooling:
whole-value masking of a **page text node** when a detector matches (email,
phone, Luhn-valid payment card, SSN-like, IPv4). Detection covers the full
snapshot and later live text mutations.

**Input values are never scanned. While this plugin is loaded, every input
value is occluded to its length instead** (`'*'.repeat(value.length)`),
whatever privacy preset you configured — including none at all. The one
exception follows from how the guarantee works: occlusion is driven by the
compiled detector set, so loading the plugin with every detector flag
disabled compiles to no detectors and does not force input occlusion. See
[Why inputs are occluded rather than scanned](#why-inputs-are-occluded-rather-than-scanned).

Attribute values are not scanned either -- attribute masking is handled by
the privacy presets and policy rules instead.

No privacy preset implies detection on its own. `balanced` and `strict` mask
form values and honor `data-privacy` / policy rules, but neither one scans
page text for emails, phones, cards, SSNs, or IP addresses unless this plugin
(or `applyPrivacyDetectors`) is used.

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

If `privacyPolicy` is omitted, the plugin keeps the `minimal` preset (existing
`maskTextFn` / `maskInputOptions` behavior) -- and still detects: detection is
independent of preset, so a bare `record({ plugins: [getRecordPrivacyDetectorsPlugin()] })`
with no `privacyPolicy` at all masks any page text node a detector matches,
at snapshot time and on live text mutations, on top of whatever `maskTextFn`
already does. Detectors only inspect text that would otherwise be recorded
unmasked: where a manual option already masks (e.g. a trusted `maskTextFn`
composition), that output is kept as-is.

Input values are the exception to "independent of preset": the plugin's
policy compiles to `maskAllInputs: true` even on a `minimal` base, so form
values are occluded to length regardless of what you configured.

For snapshot-only use (no recorder):

```js
import { snapshot } from 'rrweb-snapshot';
import { applyPrivacyDetectors } from '@rrweb/rrweb-plugin-privacy-detectors';

snapshot(document, {
  privacyPolicy: applyPrivacyDetectors({ version: 1, preset: 'balanced' }),
});
```

## Why inputs are occluded rather than scanned

Two reasons, and neither is fixable by a better pattern set.

**Scanning a value as it is typed records raw prefixes.** An input value is
re-examined on every input event. A payment card number does not trip the
`paymentCard` detector until it is long enough for Luhn to pass, so every
keystroke before that is recorded verbatim and the full number is trivially
reconstructable from the prefixes -- even though the final value comes out
masked. The same holds for an email that is only an email once the `@` and
the domain arrive.

**A clean scan is still a disclosure.** Deciding to record a value because
no detector matched publishes everything the detectors do not model:
passport and national ID numbers outside the SSN shape, non-US phone
formats, dates of birth, account and policy numbers, addresses, free-text
answers. A fixed pattern set cannot enumerate PII, so "nothing matched" is
never evidence that a value is safe.

Occluding the value to its length sidesteps both: no prefix is ever recorded,
and the decision does not depend on the pattern set being complete. Text
nodes are different in kind -- page copy is already rendered and static, is
not accumulated a character at a time, and is overwhelmingly not PII -- which
is why scanning still applies there.

If you know a field is sensitive, say so directly with `data-privacy="mask"`,
a policy rule, or a `balanced`/`strict` preset. Detectors are a backstop, not
a control.

## Known limitations (not yet production-proven)

This plugin is **experimental**. Unlike the mechanisms in the core Privacy at
Capture policy, whole-value heuristic detection on live text mutations has no
production mileage in a shipped session-replay recorder. Two limitations are
known and unfixed:

- **A plugin whose policy transform fails to compile silently downgrades
  protection.** If `applyPrivacyPolicy` returns something
  `compilePrivacyPolicy` cannot compile, `record()` falls back to the user's
  own (less restrictive) policy and continues recording, reporting the
  problem only through a `console.error`. Recording does not stop and no
  callback is invoked, so a broken transform can go unnoticed in production.
  Note that this also drops the forced input occlusion, since that rides on
  the transformed policy.
- **Text over 10,000 characters is masked wholesale without scanning.**
  `MAX_SCAN_LENGTH` bounds the work each detector does; anything longer fails
  closed and is starred in full rather than being inspected. This is safe but
  lossy — a long, entirely benign text node is destroyed in the replay.
