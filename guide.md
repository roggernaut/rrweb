# Guide

[中文指南](./guide.zh_CN.md)

> You may also want to read the [recipes](./docs/recipes/index.md) to find some use real-world use case, or read the [internal design docs](./docs/design/index.md) to know more technical details of rrweb.

## Installation

| Goal                                                | Recommended package(s)            |
| --------------------------------------------------- | --------------------------------- |
| Most projects (record + replay)                     | `@rrweb/record` + `@rrweb/replay` |
| Quick setup, one import for record, replay + packer | `@rrweb/all`                      |

In most production setups, recorder and replayer are deployed to different pages/apps. Use `@rrweb/record` on recorded pages and `@rrweb/replay` (or `rrweb-player`) on replay pages. Use `@rrweb/all` when you intentionally want one package for convenience (for example demos, tooling, or simplified setups).

> The `rrweb` package is deprecated. It still works, but new projects should use `@rrweb/record` and `@rrweb/replay` (or `@rrweb/all` for a single import) so that we can slim down and eventually remove `rrweb`.

### 1) Bundler / npm (Recommended)

```shell
npm install @rrweb/record @rrweb/replay
```

```js
import { record } from '@rrweb/record';
import { Replayer } from '@rrweb/replay';
import '@rrweb/replay/dist/style.css';
```

Use `@rrweb/all` as a convenience package if you want a single import:

```shell
npm install @rrweb/all
```

```js
import { record, Replayer } from '@rrweb/all';
import '@rrweb/all/dist/style.css';
```

`require(...)` / CommonJS remains available for compatibility via each package's `exports`/`main`, but ESM imports are the primary path for 2.x.

### 2) Browser Without Bundler (No-Build)

Use browser ESM assets from a CDN:

```html
<link
  rel="stylesheet"
  href="https://cdn.rrweb.com/replay/current/dist/style.css"
/>
<script type="module">
  import { record } from 'https://cdn.rrweb.com/record/current/dist/record.js';
  import { Replayer } from 'https://cdn.rrweb.com/replay/current/dist/replay.js';

  record({
    emit(event) {
      console.log(event);
    },
  });
</script>
```

Use `current` for the latest stable release, or pin an exact version such as
`https://cdn.rrweb.com/record/2.0.0/dist/record.js` and
`https://cdn.rrweb.com/replay/2.0.0/dist/replay.js` for immutable
production URLs.

`rrweb-player` is also available as a browser ESM asset:

```html
<link
  rel="stylesheet"
  href="https://cdn.rrweb.com/rrweb-player/current/style.css"
/>
<script type="module">
  import rrwebPlayer from 'https://cdn.rrweb.com/rrweb-player/current/rrweb-player.js';
</script>
```

### 3) Legacy Direct `<script>` Include (UMD Fallback)

Use this only for compatibility with non-module environments.

```html
<script src="https://cdn.rrweb.com/record/current/dist/record.umd.cjs"></script>
<script src="https://cdn.rrweb.com/replay/current/dist/replay.umd.cjs"></script>
```

The UMD builds expose `rrwebRecord` and `rrwebReplay` globals. Prefer the ESM
CDN assets for modern browsers.

#### Other packages

For a full list of rrweb packages with descriptions, see the [Packages reference](packages/).

### Compatibility Note

rrweb does **not** support IE11 and below because it uses the `MutationObserver` API which was supported by [these browsers](https://caniuse.com/#feat=mutationobserver).

## Getting Started

### Record

Use `record` from `@rrweb/record` in modern setups:

```js
import { record } from '@rrweb/record';
```

```js
record({
  emit(event) {
    // store the event in any way you like
  },
});
```

During recording, the recorder will emit when there is some event incurred, all you need to do is to store the emitted events in any way you like.

The `record` method returns a function which can be called to stop events from firing:

```js
let stopFn = record({
  emit(event) {
    if (events.length > 100) {
      // stop after 100 events
      stopFn();
    }
  },
});
```

A more real-world usage may look like this:

```js
const publicApiKey = 'your-public-api-key-here';
const recordingId = crypto.randomUUID();

let events = [];

record({
  emit(event) {
    // push event into the events array
    events.push(event);
  },
});

// this function will send events to the backend and reset the events array
function save() {
  const body = JSON.stringify({ events });
  events = [];
  fetch(`https://api.rrweb.com/recordings/${recordingId}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${publicApiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  });
}

// save events every 10 seconds
setInterval(save, 10 * 1000);
```

#### Record Options

The `record` function accepts the following options.

| key                      | default            | description                                                                                                                                                                                          |
| ------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| emit                     | required           | the callback function to get emitted events                                                                                                                                                          |
| checkoutEveryNth         | -                  | take a full snapshot after every N events<br />refer to the [checkout](#checkout) chapter                                                                                                            |
| checkoutEveryNms         | -                  | take a full snapshot after every N ms<br />refer to the [checkout](#checkout) chapter                                                                                                                |
| blockClass               | 'rr-block'         | Use a string or RegExp to configure which elements should be blocked, refer to the [privacy](#privacy) chapter                                                                                       |
| blockSelector            | null               | Use a string to configure which selector should be blocked, refer to the [privacy](#privacy) chapter                                                                                                 |
| ignoreClass              | 'rr-ignore'        | Use a string or RegExp to configure which elements should be ignored, refer to the [privacy](#privacy) chapter                                                                                       |
| ignoreSelector           | null               | Use a string to configure which selector should be ignored, refer to the [privacy](#privacy) chapter                                                                                                 |
| ignoreCSSAttributes      | null               | array of CSS attributes that should be ignored                                                                                                                                                       |
| maskTextClass            | 'rr-mask'          | Use a string or RegExp to configure which elements should be masked, refer to the [privacy](#privacy) chapter                                                                                        |
| maskTextSelector         | null               | Use a string to configure which selector should be masked, refer to the [privacy](#privacy) chapter                                                                                                  |
| unmaskTextSelector       | null               | Use a string to configure which selector's text should never be masked, even under `strict` or a policy `mask` rule; merged with any policy `unmask` rules, refer to the [privacy](#privacy) chapter |
| maskAllInputs            | false              | mask all input content as \*                                                                                                                                                                         |
| maskInputOptions         | { password: true } | mask some kinds of input \*<br />refer to the [list](https://github.com/rrweb-io/rrweb/blob/588164aa12f1d94576f89ae0210b98f6e971c895/packages/rrweb-snapshot/src/types.ts#L77-L95)                   |
| maskInputFn              | -                  | customize mask input content recording logic                                                                                                                                                         |
| maskTextFn               | -                  | customize mask text content recording logic                                                                                                                                                          |
| privacyPolicy            | -                  | apply a versioned `strict`, `balanced`, or `minimal` privacy policy before values are emitted, refer to the [privacy](#privacy) chapter                                                              |
| slimDOMOptions           | {}                 | remove unnecessary parts of the DOM <br />refer to the [list](https://github.com/rrweb-io/rrweb/blob/588164aa12f1d94576f89ae0210b98f6e971c895/packages/rrweb-snapshot/src/types.ts#L97-L108)         |
| dataURLOptions           | {}                 | Canvas image format and quality ,This parameter will be passed to the OffscreenCanvas.convertToBlob(),Using this parameter effectively reduces the size of the recorded data                         |
| inlineStylesheet         | true               | Deprecated since 2.0.0. Still supported, but planned to be superseded by future `captureAssets` asset recording APIs.                                                                                |
| hooks                    | {}                 | hooks for events<br />refer to the [list](https://github.com/rrweb-io/rrweb/blob/9488deb6d54a5f04350c063d942da5e96ab74075/src/types.ts#L207)                                                         |
| packFn                   | -                  | refer to the [storage optimization recipe](./docs/recipes/optimize-storage.md)                                                                                                                       |
| sampling                 | -                  | refer to the [storage optimization recipe](./docs/recipes/optimize-storage.md)                                                                                                                       |
| recordCanvas             | false              | Whether to record the canvas element. Available options:<br/>`false`, <br/>`true`                                                                                                                    |
| canvasMasking            | -                  | Runtime adapter for masking regions of FPS-captured canvas frames. See Privacy below.                                                                                                                |
| maskAllElementAttributes | false              | Masks every source string attribute in the final serialized representation. This reduces replay fidelity and takes precedence over `maskAttributeFn`.                                                |
| maskAttributeFn          | -                  | Transforms each final serialized string attribute. Portable policy rules are applied afterward and cannot be overridden by this callback.                                                            |
| recordCrossOriginIframes | false              | Whether to record cross origin iframes. rrweb has to be injected in each child iframe for this to work. Available options:<br/>`false`, <br/>`true`                                                  |
| recordAfter              | 'load'             | If the document is not ready, then the recorder will start recording after the specified event is fired. Available options: `DOMContentLoaded`, `load`                                               |
| inlineImages             | false              | Deprecated since 2.0.0. Still supported, but planned to be superseded by future `captureAssets` asset recording APIs.                                                                                |
| collectFonts             | false              | whether to collect fonts in the website                                                                                                                                                              |
| userTriggeredOnInput     | false              | whether to add `userTriggered` on input events that indicates if this event was triggered directly by the user or not. [What is `userTriggered`?](https://github.com/rrweb-io/rrweb/pull/495)        |
| plugins                  | []                 | load plugins to provide extended record functions. [What are plugins?](./docs/recipes/plugin-api.md)                                                                                                 |
| errorHandler             | -                  | A callback that is called if something inside of rrweb throws an error. The callback receives the error as argument.                                                                                 |

#### Privacy

The existing rrweb masking options are always available and are exactly what
you get by default (the `minimal` preset, below):

- An element with the class name `.rr-block` will not be recorded. Instead, it will replay as a placeholder with the same dimension.
- An element with the class name `.rr-ignore` will not record its input events.
- All text of elements with the class name `.rr-mask` and their children will be masked.
- `input[type="password"]` will be masked by default.
- Mask options to mask the content in input elements.

For a consistent policy across text, inputs, and attributes, pass a
versioned `privacyPolicy`:

```js
record({
  emit(event) {
    // store event
  },
  privacyPolicy: {
    version: 1,
    preset: 'balanced',
    rules: [
      {
        target: { type: 'selector', selector: '.public-customer-name' },
        action: 'unmask',
      },
      {
        target: { type: 'selector', selector: '.private' },
        action: 'mask',
      },
      {
        target: { type: 'selector', selector: '.payment-widget' },
        action: 'block',
      },
    ],
  },
});
```

`preset` compiles to the following, on top of the `rules` above:

| preset              | behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimal` (default) | Inert: only the existing masking options above apply. `rules` still work (below), but the `data-privacy` attribute and cross-vendor class recognition described below are off.                                                                                                                                                                                                                                                                                                                                  |
| `balanced`          | Masks every input value (like `maskAllInputs: true`); masks the `title`, `placeholder`, and `aria-label` attributes on every element. Page text is untouched.                                                                                                                                                                                                                                                                                                                                                   |
| `strict`            | Everything `balanced` does, plus: all page text is masked; media element sources (`<img>`, `<video>`, `<audio>`, `<iframe>`, `<embed>`, `<object>`, `<source>`) are dropped instead of captured, except that an `<img>` source or `<video>` poster on an element with declared integer `width`/`height` attributes is replaced by a neutral same-size placeholder image so the surrounding layout does not collapse; and canvas recording is disabled outright, even with a `canvasMasking` adapter configured. |

`minimal` is a permanent tier, not a transitional one: it is masking you
configure yourself, through the classic options above. Password and
payment input fields (native form controls) are always masked regardless
of preset or configuration.
`balanced` and `strict` are the managed presets.

Masking an input value also suppresses the `selected` flag on the
`<option>` elements of a `<select>`: which option is selected discloses the
select's value just as the value itself does, so both follow one decision.
This applies under `balanced`/`strict` and (as before) under
`maskAllInputs` or `maskInputOptions.select`.

CSS is never masked, on any preset or code path: `style`/`_cssText`
attributes and `<style>` element text are exempt from every masking branch,
including live `characterData` mutations.

rrweb's own operational attributes -- `data-privacy` and
`data-rr-is-password` -- are exempt too, on every preset and including under
`maskAllElementAttributes` and `maskAttributeFn`. Masking them would only
destroy the recorder's own signals: a starred `data-privacy` hides the
declaration that explains why a subtree is masked, and a starred
`data-rr-is-password` breaks the password re-detection that reads it back at
replay.

##### Annotate the markup: the `data-privacy` attribute

`data-privacy` is rrweb's standard way to declare privacy intent. Put it on
the element whose subtree it describes; under `balanced` and `strict` it is
recognized directly in markup, no extra configuration required:

```html
<section data-privacy="block">Never capture this subtree</section>
<section data-privacy="ignore">
  Mask content, and never emit its input events
</section>
<section data-privacy="mask">Mask content in this subtree</section>
<span data-privacy="unmask">This content may be captured</span>
```

The attribute names no vendor on purpose. That is what makes it portable:
the declaration lives with the markup it protects, so it survives template
refactors, a change of recorder configuration, and a change of
session-replay tool -- write it once and it keeps meaning the same thing.
It is also the annotation closest to the thing being protected: whoever adds
a field to a form is the person who knows whether it is sensitive, and they
can say so in the same edit rather than in a selector list maintained
somewhere else.

The four values above are the whole vocabulary, and they are case-sensitive.
They form a severity ladder, `unmask < mask < ignore < block`, and the
nearest annotated ancestor decides. `ignore` is `mask` plus event silence:
the subtree's content is masked exactly as under `data-privacy="mask"`, and
nothing typed or clicked in it is ever emitted -- not even a length-only
starred value. A descendant `data-privacy="unmask"` inside an `ignore`
subtree re-enables both content and events, exactly as it does inside
`mask`; `block` remains absolute, and on one element the strictest verb
present wins.

The legacy `.rr-ignore` class (with the `ignoreClass`/`ignoreSelector`
options) is an event-suppression-only noise control -- per-element, input
events only, and it never masks content -- NOT a privacy mechanism.
`data-privacy="ignore"` is its privacy-grade replacement.

**Any other value masks.** `data-privacy="masked"`, `data-privacy="Block"`,
`data-privacy=""` -- each of these protects the subtree exactly as
`data-privacy="mask"` would. A value outside the vocabulary is a typo or a
value from a version of rrweb that does not recognize it yet, and in both
cases the author was reaching for protection, so the unknown value fails
closed rather than making no decision. (This is a change from earlier
pre-release builds, where an unknown value made no decision at all and the
element inherited from its nearest annotated ancestor.)

`mask-inputs` is reserved for a future input-only treatment; it is not
implemented, so today it masks like any other unrecognized value. Do not
use it to mean anything else.

> `data-privacy` is a managed-preset feature. Under `minimal` it is off
> entirely -- for every action, with or without rules -- and `rules` compile
> to their bare selectors and nothing else. Switch to `balanced`/`strict` for
> `data-privacy` support.

##### Selector rules: for what the markup cannot reach

Annotating the markup is not always possible -- third-party widgets, a
templating layer you do not own, markup generated by a component library. For
those, declare the same intent by selector in the policy.

Rules (`rules: [{ target: { type: 'selector', selector }, action }]`) accept
`mask`, `unmask`, or `block` -- the same three names as the `data-privacy`
values -- and work under every preset, including `minimal`. An unrecognized
action throws at compile time rather than being ignored. For text and for
the masked-attribute defaults (`title`/`placeholder`/`aria-label`), the
nearest matching ancestor decides, walking from the node up to the document
root; if the very same element matches both a mask and an unmask selector,
**mask** wins there (the same tie-break Sentry, Amplitude and Mixpanel use
for text). `strict`'s mask-everything default is a fallback, not a marker,
so it never takes part in that tie: an unmask ancestor still escapes it.
`block` removes a subtree from capture entirely (it replays as a
placeholder), which is why a `block` decision can't be reopened by a nested
`mask` or `unmask`.
Protected inputs -- password, hidden, and autocomplete `cc-*` /
`current-password` / `new-password` / `one-time-code` fields -- always stay
masked, regardless of any rule or preset. This holds even with no
`privacyPolicy` configured at all, and regardless of `maskInputOptions` --
these fields cannot be opted back into raw recording. (Previously, under
`minimal`, `hidden` inputs and autocomplete-tagged credit-card/password/OTP
fields could record their raw value; that is a breaking change from pre-v2
behavior.)

##### Vendor class recognition: opt-in migration compatibility

Under `balanced` and `strict`, rrweb always recognizes its own conventions:

- Mask: `.rr-mask`
- Block: `.rr-block`
- Unmask: `.rr-unmask`

A page already instrumented for another session-replay tool also carries
that tool's own mask/block class names. Set `vendorCompat: true` on the
policy and rrweb recognizes those too, so such a page keeps the protection
it already has from the moment you switch recorders, with no re-annotation
pass:

```js
record({
  privacyPolicy: { version: 1, preset: 'balanced', vendorCompat: true },
});
```

`vendorCompat` takes three forms. `true` merges the mask, block, and
events-only ignore tokens of every vendor in the table below. An array of
vendor ids merges only the
named vendors' tokens -- say `vendorCompat: ['posthog', 'datadog']` for a
page annotated for exactly those two tools; the ids are `mixpanel`,
`fullstory`, `amplitude`, `posthog`, `sentry`, `datadog`, `newrelic`,
`highlight`, `logrocket`, `hotjar`, `clarity`, `smartlook`, `openreplay`,
`contentsquare`, `heap`, `mouseflow`, `luckyorange`, `inspectlet`,
`dynatrace`, `userback`, `zipy`, `quantummetric`, `glassbox`,
`sessionstack`, and `sessionrewind`, and an unknown id is dropped with a
`console.warn` naming it. An empty array (like `false` or leaving it
unset) merges nothing.

It is off by default because recognizing a foreign token changes what rrweb
records based on markup the embedder may not control -- a class name that
means "mask" to one tool may be an ordinary styling hook here -- so the
decision to honor another vendor's vocabulary is made explicitly.

**Honoring your own unmask class.** A tool adopting rrweb that wants its own
reveal token honored (say `.acme-unmask`) declares it explicitly, through
`unmaskTextSelector` or an `unmask` policy rule -- never through
`vendorCompat`. The invariant holds for every form of the setting:
`vendorCompat` merges mask and block tokens only, so no unmask/allow token
of any vendor is ever merged.

Every token below was verified against the vendor's official documentation
or open-source SDK. The mapping rule: each token maps to the closest
treatment rrweb's verbs express -- **mask** (text occluded, element still
recorded), **block** (subtree removed or placeholdered), or **ignore**
(input events suppressed, content untouched) -- and never to a less
protective one. A vendor's ignore token silences input events from the
annotated element itself, exactly as that vendor's recorder does; it
carries no masking, unlike the native `data-privacy="ignore"`, which is
mask plus silence. Vendors whose masking is configured purely from
their own console with no reserved markup (Pendo, Statsig, Sprig, Userpilot,
Cobrowse) have nothing to recognize.

| Vendor                   | Mask tokens                                                                                                          | Block tokens                                                                  | Source                                                                                                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mixpanel                 | `.mp-mask`                                                                                                           | `.mp-block`                                                                   | mixpanel-js `src/recorder/masking.js`, `src/mixpanel-core.js`                                                                                                                                                                                                                                  |
| FullStory                | `.fs-mask`, `.fs-mask-without-consent`                                                                               | `.fs-exclude`, `.fs-exclude-without-consent`                                  | "How do I protect my users' privacy in Fullstory?" (`-without-consent` variants are masked until FullStory's consent API reveals them; rrweb has no such API, so they are always honored)                                                                                                      |
| Amplitude                | `.amp-mask`                                                                                                          | `.amp-block`                                                                  | Amplitude-TypeScript `session-replay-browser/src/constants.ts`                                                                                                                                                                                                                                 |
| PostHog                  | `.ph-mask`                                                                                                           | `.ph-no-capture`                                                              | posthog-js `lazy-loaded-session-recorder.ts`                                                                                                                                                                                                                                                   |
| Sentry                   | `.sentry-mask`, `[data-sentry-mask]`                                                                                 | `.sentry-block`, `[data-sentry-block]`                                        | sentry-javascript `replay-internal/src/util/getPrivacyOptions.ts`                                                                                                                                                                                                                              |
| Datadog                  | `.dd-privacy-mask`, `[data-dd-privacy="mask"]`, `.dd-privacy-mask-user-input`, `[data-dd-privacy="mask-user-input"]` | `.dd-privacy-hidden`, `[data-dd-privacy="hidden"]`                            | browser-sdk `browser-rum-core/src/domain/privacyConstants.ts` (`mask-user-input` masks only form values there; here it masks text too, the safe direction)                                                                                                                                     |
| New Relic                | `.nr-mask`, `[data-nr-mask]`                                                                                         | `.nr-block`, `[data-nr-block]`                                                | newrelic-browser-agent `src/common/config/init.js`                                                                                                                                                                                                                                             |
| Highlight / LaunchDarkly | `.highlight-mask`                                                                                                    | `.highlight-block`                                                            | LaunchDarkly "Configuration for session replay"; `sdk/highlight-run/src/client/index.tsx`                                                                                                                                                                                                      |
| LogRocket                |                                                                                                                      | `[data-private]` (any value), `._lr-hide`                                     | LogRocket DOM reference (`data-private` records only dimensions, which matches block)                                                                                                                                                                                                          |
| Hotjar                   |                                                                                                                      | `[data-hj-suppress]`, `.data-hj-suppress`                                     | "How to Suppress Text, Images, Videos and User Input" (both spellings documented; images are placeholdered, so block)                                                                                                                                                                          |
| Microsoft Clarity        | `[data-clarity-mask]`                                                                                                |                                                                               | "Clarity masking"                                                                                                                                                                                                                                                                              |
| Smartlook                | `[data-sl="mask"]`, `[data-recording-sensitive]` (legacy)                                                            | `[data-sl="exclude"]`, `[data-recording-disable]` (legacy)                    | Smartlook web Privacy API; the legacy attributes are documented only in the 2021 docs, but the current `web-sdk.smartlook.com` bundle still honors them                                                                                                                                        |
| OpenReplay               | `[data-openreplay-obscured]`, `[data-openreplay-masked]` (deprecated alias)                                          | `[data-openreplay-hidden]`, `[data-openreplay-htmlmasked]` (deprecated alias) | OpenReplay "Sanitize data"; `tracker/src/main/app/sanitizer.ts`                                                                                                                                                                                                                                |
| Contentsquare            | `[data-cs-encrypt]` (encrypted capture there; masked here)                                                           | `[data-cs-mask]` (content removed from collection)                            | Contentsquare "Personal data handling"                                                                                                                                                                                                                                                         |
| Heap                     | `[data-heap-redact-text]`, `[data-heap-redact-attributes]` (attribute values there; text here)                       | `[heap-ignore]`                                                               | Heap "Ignoring sensitive data and PII"; `heap-1.js` selects `[heap-ignore]`, so only the attribute form is recognized                                                                                                                                                                          |
| Mouseflow                | `.mf-masked`, `[data-mf-replace]`, `[data-mf-replace-inner]`                                                         | `.mf-excluded`                                                                | Mouseflow "Excluding, masking and replacing content via code"                                                                                                                                                                                                                                  |
| Lucky Orange             |                                                                                                                      | `.lo-sensitive`, `.losensitive` (text scrambled and images blanked, so block) | Lucky Orange "Privacy tools"                                                                                                                                                                                                                                                                   |
| Inspectlet               | `.inspectlet-sensitive`, `.inspectletIgnore`                                                                         |                                                                               | Inspectlet "Excluding sensitive data"                                                                                                                                                                                                                                                          |
| Dynatrace                | `[data-dtrum-mask]`                                                                                                  |                                                                               | Dynatrace Session Replay "URL exclusion and masking"                                                                                                                                                                                                                                           |
| Userback                 |                                                                                                                      | `.userback-block`                                                             | Userback "Session replay"                                                                                                                                                                                                                                                                      |
| Zipy                     |                                                                                                                      | `.zipy-block`                                                                 | Zipy "Sensitive user data"                                                                                                                                                                                                                                                                     |
| Quantum Metric           | `[data-qm-encrypt]` (encrypted capture there; masked here)                                                           | `[data-qm-block]`, `[data-qm-freeze-exclude]`                                 | No public docs; read from the shipped engine at `cdn.quantummetric.com/qscripts/quantum-*.js` (`encryptScrubList:["[data-qm-encrypt]"]`; `excludeDOMList` receives `[data-qm-freeze-exclude]`; `[data-qm-block]` appears in several customers' scrub rule sets rather than the engine default) |
| Glassbox                 | `.cls_mask` (input values)                                                                                           |                                                                               | No public docs; read from the shipped `detector-dom.min.js` SDK, where `cls_mask` is the one hard-coded owner-facing token and everything else is console configuration                                                                                                                        |
| SessionStack             | `.sessionstack-sensitive`                                                                                            |                                                                               | SessionStack "Sensitive data" (archived copy; the live page blocks non-browser clients)                                                                                                                                                                                                        |
| Session Rewind           | `[data-sr-redact]`                                                                                                   |                                                                               | Session Rewind "Privacy settings" (Notion docs) and the `session-rewind-prod.js` recorder                                                                                                                                                                                                      |

Ignore tokens, recognized as events-only: Sentry's `.sentry-ignore` and
`[data-sentry-ignore]` (their rrweb `ignoreSelector` defaults), PostHog's
`.ph-ignore-input` (their `ignoreClass`), New Relic's `.nr-ignore` (their
constant `ignore_class`; no attribute form ships), and Highlight's
`.highlight-ignore` (their `ignoreClass`). Each was verified from the
vendor's source to suppress input events only, so honoring it can only
reduce what is recorded; the annotated element's content records normally,
exactly as it does under that vendor.

Not recognized, deliberately: every vendor's reveal token (`.fs-unmask`,
`.amp-unmask`, `.nr-unmask`, `[data-dd-privacy="allow"]`, `[data-hl-record]`,
`[data-public]`, `[data-hj-allow]`, `[data-clarity-unmask]`,
`[data-sl="unmask"]`, `[data-openreplay-unmask]`, `[data-cs-capture]`,
`.lo-not-sensitive`, `[data-dtrum-allow]`, `[data-qm-allow]`), the
ignore-like tokens whose events-only semantics have no verified source
(`.userback-ignore`, `[data-recording-ignore]`), and
Mouseflow's `.mf-listen` modifier. Smartlook's `smartlook-hide` class is a
mobile-WebView convention with no presence in the web bundle, and Heap's
bare `heap-redact` is a documentation umbrella term rather than a token;
neither is recognized. Nothing here rests on a guessed spelling: a token
without a reachable official document or a shipped SDK to read it from is
left out.

`vendorCompat` can only ever **reduce** what is recorded, never reveal:
enabling it merges only these mask, block, and events-only ignore lists.
No foreign tool's unmask/allow convention is ever honored, on either
setting -- not even Amplitude's own `.amp-unmask` -- because doing so would
let markup the embedder may not control turn masking off. Unmasking comes
only from `.rr-unmask`, the neutral `data-privacy="unmask"` attribute, or an
explicit policy/recording option. If you want the compat mask/block lists,
add the classes you need as `mask`/`block` rules instead.

Datadog's `allow` and `mask-unless-allowlisted` values are excluded as
reveal conventions. Datadog has no customer-facing ignore token: its
internal `ignore` level covers scripts and metadata tags, not annotated
elements, so nothing of Datadog's compiles into the ignore list.

(`.rr-mask` and `.rr-block` also work under `minimal`, through the existing
`maskTextClass`/`blockClass` options above. `vendorCompat` has no effect
under `minimal`, which merges no class conventions of its own; setting it
there logs a one-time `console.warn` rather than being silently ignored.)

##### Escape hatches and selector validation

`unmaskTextSelector` is a `record()`-level escape hatch for text: a plain CSS
selector (merged with any policy `unmask` rule selectors) that stays
unmasked even under `strict`'s mask-everything default or a `mask` rule. It
covers text and the preset's masked attributes (`title`, `placeholder`,
`aria-label`) on elements inside the matched subtree -- this option, a policy
`unmask` rule and a recognized unmask class are merged into one
selector and behave identically. It cannot unmask input
values, and it cannot override a protected input, a dropped media source
under `strict`, or a `block`.

An invalid `maskTextSelector`, `unmaskTextSelector` or `blockSelector` --
either the `record()`-level string option or a policy rule's selector -- is
validated at setup and **dropped with a `console.warn`** that names the
fragments it dropped. Validation is per comma-separated fragment: in
`.pii, .broken:has-typo(` only the malformed half is dropped and `.pii`
keeps working, so one malformed fragment cannot take the others down with
it -- including when the malformed half has a stray closing bracket or an
unterminated quote, which is demoted to plain text rather than allowed to
swallow the separators after it. Recording continues with the remaining selectors; a dropped
`mask`/`block` selector therefore protects nothing, so watch for that
warning rather than treating it as cosmetic. Where there is no `document` to
validate against at all (server-side rendering, a worker), selectors are
assumed valid rather than all dropped.
A selector that passes validation but throws while matching (a hostile
`matches` override, a detached document) still fails closed: a mask decision
masks the affected text and attributes, and a block decision blocks the
affected element, each with a one-time `console.warn`.

```js
record({
  privacyPolicy: { version: 1, preset: 'strict' },
  unmaskTextSelector: '.support-widget',
});
```

##### Attribute and input masking callbacks

For unusual attribute-bearing applications, `maskAllElementAttributes` is the
coarse fail-closed option and `maskAttributeFn(name, value, element)` is the
targeted escape hatch. `maskAllElementAttributes` and `maskAttributeFn` are
mutually exclusive: if both are supplied, `maskAllElementAttributes` wins and
`maskAttributeFn` is ignored, with a one-time console warning. A throwing
`maskAttributeFn` fails closed to stars rather than leaking the original
value. Under `minimal`, `maskAttributeFn`'s return value is used as-is; under
`balanced`/`strict` the compiled policy still runs on top of it
(`title`/`placeholder`/`aria-label` masking, `strict`'s media-source drop)
and can only
narrow what the callback chose to keep, never restore something the policy
would otherwise mask. `style`/`_cssText` are exempt from all of this.
Likewise, under `minimal`, `maskInputFn`'s return value is trusted verbatim;
under `balanced`/`strict`, `maskInputFn` output is star-replaced -- the
callback controls length, never content. Every callback fails closed the
same way: a `maskInputFn` or `maskTextFn` that throws, or returns anything
other than a string, yields stars for the raw value instead of aborting the
snapshot or recording the value. Protected inputs (see above) never reach
`maskInputFn` at all, and an input whose `type` or `autocomplete` cannot be
read (a proxied or cross-realm element that throws on property access) is
treated as protected.

##### Canvas masking

Canvas applications can provide capture-time regions when using FPS canvas
sampling. Coordinates are CSS pixels relative to the canvas. Return `[]` when
the frame is safe unchanged, or `null`/`undefined` when regions cannot be
computed; rrweb skips unanswerable frames. Invalid rectangles and thrown
errors also fail closed. Regions are scaled against the canvas's layout
content box (`clientWidth`/`clientHeight` minus padding), never its
transformed bounding rect, so a CSS `transform` on the canvas cannot shrink
a mask. Supplying `canvasMasking` at all forces
`sampling.canvas` onto the FPS/OffscreenCanvas capture path (defaulting to
`4` if you haven't already set a number), regardless of what `isConfigured()`
answers at that moment -- the capture mode is fixed at `record()` while
`isConfigured()` is re-read every frame, and a provider that switches on
later must already be on the path that can mask. That path is the only one
that renders full frames through the masking adapter before they reach the
encoding worker -- the raw command-stream capture mode
(`sampling.canvas: 'all'`) replays canvas API calls verbatim and has no way to
redact anything. Configuring the adapter also suppresses the separate
`rr_dataURL` full-snapshot path, so an unmasked still can't bypass it.

```js
record({
  recordCanvas: true,
  sampling: { canvas: 4 },
  canvasMasking: {
    maskRegions(canvas) {
      return findSensitiveCanvasRegions(canvas); // [{ x, y, width, height }]
    },
  },
});
```

##### Migrating to Privacy at Capture

Breaking changes versus pre-2.0 masking, for anyone upgrading:

- `needMaskingText` and `serializeNodeWithId` (from `rrweb-snapshot`) take the
  mask-text selector pre-split (`{maskAll, selector}`, from the exported
  `splitMaskAllSelector`) instead of a raw string. Two coercions keep an
  unmigrated caller masking rather than silently matching nothing: a raw
  string or `null` in the selector slot is split on the spot, and a
  `needMaskingText` call using the pre-2.0 positional signature
  `(node, maskTextClass, maskTextSelector, checkAncestors)` is detected by
  the boolean in the fourth slot and shifted back into place, so its ancestor
  walk still happens. Migrate anyway -- the coercions are a safety net, not a
  supported signature.
- `<style>` text inside masked subtrees is never masked, on any path: CSS is
  never masked.
- `maskInputFn` output is star-replaced under `balanced`/`strict` (length
  only, never content); `maskAttributeFn` output is policy-final and mutually
  exclusive with `maskAllElementAttributes` (the latter wins, with a one-time
  warning).
- `password`/`hidden` inputs and autocomplete `cc-*`/`current-password`/
  `new-password`/`one-time-code` fields (native form controls; custom
  elements follow upstream behavior) are now always masked regardless of
  `maskInputOptions`; previously some could record raw under `minimal`.
- An invalid `maskTextSelector`/`unmaskTextSelector`/`blockSelector` is now
  dropped with a `console.warn` at setup instead of silently ignored, per
  comma-separated fragment rather than whole-string.
- Same-element mask/unmask ties now resolve to masking (previously unmask
  won).
- Unmasking recognizes only `.rr-unmask`, `data-privacy="unmask"`, and
  explicit policy/`record()` selectors. No foreign tool's unmask convention
  is ever honored, on either `vendorCompat` setting (a page author's mask
  decision is never overridden by a convention rrweb cannot verify).
- Masking a form value also suppresses a `<select>` option's `selected` flag,
  via the new exported `shouldMaskInput` predicate.
- `maskInputValue` is deprecated in favor of `maskInput`.
- `canvasMasking` only forces the FPS capture path when masking is actually
  in force; `record()` no longer mutates the `sampling` object it was passed
  and no longer re-exports `resolveCanvasSampling`.
- `rrweb-snapshot`'s privacy types are re-exports from `@rrweb/types`, the new
  source of truth; `rrweb-snapshot`'s public type surface is unchanged.
- `ImageBitmapDataURLWorkerParams` (`@rrweb/types`) is now a union; privacy
  rule `style`/`classification`, heuristic detectors, and the `'custom'`
  preset are removed from the policy schema. Heuristic detectors return as
  an opt-in `@rrweb/rrweb-plugin-privacy-detectors` package in a follow-up
  change.
- `data-privacy` and the native `rr-*` class conventions are managed-preset
  features: under `minimal` a `mask`/`block`/`unmask` rule compiles to its
  bare selector and switches nothing else on. (An earlier iteration turned
  `data-privacy` on under `minimal` as soon as a same-action rule existed.)
- These privacy helpers were removed from `rrweb-snapshot`'s exports, their
  behavior folded into the plain masking primitives (`maskInput`,
  `shouldMaskInput`, `resolveTextValue`, `finalizeAttribute`) plus the
  compiled policy: `maskTextWithPrivacy`, `maskInputWithPrivacy`,
  `shouldMaskInputWithPrivacy`, `maskAttributeWithPrivacy`,
  `protectSerializedAttribute`, `getPrivacyAction`, and
  `mergeBlockSelectors`.
- `rrweb-snapshot`'s barrel now also re-exports three internals --
  `splitSelectorList`, `stars`, and `validateSelector`. They are `@internal`
  and **unstable**: exported for cross-package use and direct unit testing,
  not part of the supported API, and free to change or disappear without a
  major bump.

##### For event consumers

The changes above are about configuring the recorder. If you consume the
recorded event stream directly -- a replayer, an exporter, a redaction
auditor -- Privacy at Capture changes what shows up on the wire, independent
of any config you pass:

- An attribute value can now be `null` where it previously carried a string.
  This means the attribute was dropped entirely, not emptied -- e.g. a
  blocked `<audio src>` with no placeholder to fall back to. Treat `null`
  the same as "attribute absent," not as an empty string.
- A masked media source (`src`, `poster`, and similar, on `<img>`/`<video>`)
  is replaced by an inline `data:image/svg+xml` URI -- a solid-color
  rectangle at the element's declared pixel `width`/`height` -- rather than
  by the original bytes or a bare placeholder token. Layout-dependent
  consumers can keep sizing off it; anything reading pixel content will see
  the placeholder, not the source image.
- Masked text is star-replaced character by character (`\S` becomes `*`);
  whitespace, including newlines, is left untouched so line breaks and
  spacing in the original still show through the stars.
- With a `canvasMasking` adapter configured, canvas capture switches to the
  FPS frame-image path: periodic full-frame snapshot events rather than
  incremental drawing-command mutations. A consumer that replays canvas
  mutations command-by-command will instead see whole-frame "keyframe"
  events at the configured sampling rate. Under `strict` this does not
  apply, because `strict` emits **no** canvas events at all: `blockMedia`
  disables `recordCanvas` outright, even where it was explicitly requested
  (with a one-time `console.warn`).
- Canvas elements inside a shadow root are discovered only through **native**
  shadow roots. A polyfilled shadow root is no longer walked for canvases, so
  canvases that live only inside one are not captured.

One more thing worth flagging if your pages already use a `data-privacy`
attribute for something unrelated to rrweb: under `balanced`/`strict`,
rrweb now reads that attribute as its own privacy binding regardless of who
put it there or why. An element carrying `data-privacy="mask"` for some
other purpose gets masked; an unrecognized value on it also masks (see the
fail-closed rule above). This is a real collision, not a bug -- it is
deliberately over-protective, on the theory that a false positive (masking
something that did not need it) is a better failure mode than a false
negative (missing something that did).

#### Checkout

By default, all the emitted events are required to replay a session and if you do not want to store all the events, you can use the checkout config.

**Most of the time you do not need to configure this**. But if you want to do something like capturing just the last N events from when an error has occurred, here is an example:

```js
const publicApiKey = 'your-public-api-key-here';
const recordingId = crypto.randomUUID();

// We use a two-dimensional array to store multiple events array
const eventsMatrix = [[]];

record({
  emit(event, isCheckout) {
    // isCheckout is a flag to tell you the events has been checkout
    if (isCheckout) {
      eventsMatrix.push([]);
    }
    const lastEvents = eventsMatrix[eventsMatrix.length - 1];
    lastEvents.push(event);
  },
  checkoutEveryNth: 200, // checkout every 200 events
});

// send last two events array to the backend
window.onerror = function () {
  const len = eventsMatrix.length;
  const events = eventsMatrix[len - 2].concat(eventsMatrix[len - 1]);
  const body = JSON.stringify({ events });
  fetch(`https://api.rrweb.com/recordings/${recordingId}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${publicApiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  });
};
```

Due to the incremental-snapshot-chain mechanism rrweb used, we can not capture the last N events accurately. With the sample code above, you will finally get the last 200 to 400 events been sent to your backend.

Similarly, you can also configure `checkoutEveryNms` to capture the last N minutes events:

```js
const publicApiKey = 'your-public-api-key-here';
const recordingId = crypto.randomUUID();

// We use a two-dimensional array to store multiple events array
const eventsMatrix = [[]];

record({
  emit(event, isCheckout) {
    // isCheckout is a flag to tell you the events has been checkout
    if (isCheckout) {
      eventsMatrix.push([]);
    }
    const lastEvents = eventsMatrix[eventsMatrix.length - 1];
    lastEvents.push(event);
  },
  checkoutEveryNms: 5 * 60 * 1000, // checkout every 5 minutes
});

// send last two events array to the backend
window.onerror = function () {
  const len = eventsMatrix.length;
  const events = eventsMatrix[len - 2].concat(eventsMatrix[len - 1]);
  const body = JSON.stringify({ events });
  fetch(`https://api.rrweb.com/recordings/${recordingId}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${publicApiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  });
};
```

With the sample code above, you will finally get the last 5 to 10 minutes of events been sent to your backend.

### Replay

For bundler usage, include the style sheet in your app entry:

```js
import '@rrweb/replay/dist/style.css';
```

For browser/no-build usage, include the style sheet and import the replayer from
the CDN:

```html
<link
  rel="stylesheet"
  href="https://cdn.rrweb.com/replay/current/dist/style.css"
/>
<script type="module">
  import { Replayer } from 'https://cdn.rrweb.com/replay/current/dist/replay.js';

  const events = YOUR_EVENTS;

  const replayer = new Replayer(events);
  replayer.play();
</script>
```

#### Control the replayer by API

```js
const replayer = new Replayer(events);

// play
replayer.play();

// play from the third seconds
replayer.play(3000);

// pause
replayer.pause();

// pause at the fifth seconds
replayer.pause(5000);

// destroy the replayer (hint: this operation is irreversible)
replayer.destroy();
```

#### Replay Options

The replayer accepts options as its constructor's second parameter, and it has the following options:

| key                     | default       | description                                                                                                                                                                                                                    |
| ----------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| speed                   | 1             | replay speed ratio                                                                                                                                                                                                             |
| root                    | document.body | the root element of replayer                                                                                                                                                                                                   |
| loadTimeout             | 0             | timeout of loading remote style sheet                                                                                                                                                                                          |
| skipInactive            | false         | whether to skip inactive time                                                                                                                                                                                                  |
| inactivePeriodThreshold | 10000         | the threshold in milliseconds for what should be considered an inactive period                                                                                                                                                 |
| showWarning             | true          | whether to print warning messages during replay                                                                                                                                                                                |
| showDebug               | false         | whether to print debug messages during replay                                                                                                                                                                                  |
| blockClass              | 'rr-block'    | element with the class name will display as a blocked area                                                                                                                                                                     |
| liveMode                | false         | whether to enable live mode                                                                                                                                                                                                    |
| insertStyleRules        | []            | accepts multiple CSS rule string, which will be injected into the replay iframe                                                                                                                                                |
| triggerFocus            | true          | whether to trigger focus during replay                                                                                                                                                                                         |
| UNSAFE_replayCanvas     | false         | whether to replay the canvas element. **Enabling this adds `allow-scripts` to the replay iframe and opts out of the sandbox script-execution protection, which is unsafe.**                                                    |
| pauseAnimation          | true          | whether to pause CSS animation when the replayer is paused                                                                                                                                                                     |
| mouseTail               | true          | whether to show mouse tail during replay. Set to false to disable mouse tail. A complete config can be found in this [type](https://github.com/rrweb-io/rrweb/blob/9488deb6d54a5f04350c063d942da5e96ab74075/src/types.ts#L407) |
| unpackFn                | -             | refer to the [storage optimization recipe](./docs/recipes/optimize-storage.md)                                                                                                                                                 |
| logConfig               | -             | configuration of console output playback, refer to the [console recipe](./docs/recipes/console.md)                                                                                                                             |
| plugins                 | []            | load plugins to provide extended replay functions. [What are plugins?](./docs/recipes/plugin-api.md)                                                                                                                           |
| useVirtualDom           | true          | whether to use Virtual Dom optimization in the process of skipping to a new point of time                                                                                                                                      |
| logger                  | console       | The logger object used by the replayer to print warnings or errors                                                                                                                                                             |

#### Use rrweb-player

Since `Replayer` from [@rrweb/replay](packages/replay/) only provides a basic UI, you can choose [rrweb-player](packages/rrweb-player/), which is based on rrweb's public APIs and provides a feature-rich replayer UI.

##### Installation

Bundler / npm (recommended):

```shell
npm install rrweb-player
```

```js
import rrwebPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
```

Browser without bundler (ESM):

```html
<link
  rel="stylesheet"
  href="https://cdn.rrweb.com/rrweb-player/current/style.css"
/>
<script type="module">
  import rrwebPlayer from 'https://cdn.rrweb.com/rrweb-player/current/rrweb-player.js';
</script>
```

Legacy direct `<script>` include (UMD fallback):

```html
<link
  rel="stylesheet"
  href="https://cdn.rrweb.com/rrweb-player/current/style.css"
/>
<script src="https://cdn.rrweb.com/rrweb-player/current/rrweb-player.umd.cjs"></script>
```

##### Usage

```js
new rrwebPlayer({
  target: document.body, // customizable root element
  props: {
    events,
  },
});
```

##### Options

| key            | default      | description                                                          |
| -------------- | ------------ | -------------------------------------------------------------------- |
| events         | []           | the events for replaying                                             |
| width          | 1024         | the width of the replayer                                            |
| height         | 576          | the height of the replayer                                           |
| maxScale       | 1            | the maximum scale of the replayer (1 = 100%), set to 0 for unlimited |
| autoPlay       | true         | whether to autoplay                                                  |
| speedOption    | [1, 2, 4, 8] | speed options in UI                                                  |
| showController | true         | whether to show the controller UI                                    |
| tags           | {}           | customize the custom events style with a key-value map               |
| ...            | -            | all other Replayer options are forwarded                             |

#### Events

Developers may want to extend the replayer or respond to its events, for example to notify users when inactive time starts being skipped.
`Replayer` exposes a public API `on` that lets developers listen for events and customize behavior:

```js
const replayer = new Replayer(events);
replayer.on(EVENT_NAME, (payload) => {
  ...
})
```

The event list:

| Event                  | Description                         | Value             |
| ---------------------- | ----------------------------------- | ----------------- |
| start                  | started to replay                   | -                 |
| pause                  | paused the replay                   | -                 |
| finish                 | finished the replay                 | -                 |
| resize                 | the viewport has changed            | { width, height } |
| fullsnapshot-rebuilded | rebuilded a full snapshot           | event             |
| load-stylesheet-start  | started to load remote stylesheets  | -                 |
| load-stylesheet-end    | loaded remote stylesheets           | -                 |
| skip-start             | started to skip inactive time       | { speed }         |
| skip-end               | skipped inactive time               | { speed }         |
| mouse-interaction      | mouse interaction has been replayed | { type, target }  |
| event-cast             | event has been replayed             | event             |
| custom-event           | custom event has been replayed      | event             |
| destroy                | destroyed the replayer              | -                 |

The rrweb-replayer also re-expose the event listener via a `component.addEventListener` API.

And there are three rrweb-replayer event will be emitted in the same way:

| Event                  | Description                      | Value       |
| ---------------------- | -------------------------------- | ----------- |
| ui-update-current-time | current time has changed         | { payload } |
| ui-update-player-state | current player state has changed | { payload } |
| ui-update-progress     | current progress has changed     | { payload } |

## REPL tool

You can also play with rrweb by using the REPL testing tool which does not need installation.

Run `yarn repl` to launch a browser and ask for a URL you want to test on the CLI:

```
Enter the url you want to record, e.g https://example.com:
```

Waiting for the browser to open the specified page and print the following messages on the CLI:

```
Enter the url you want to record, e.g https://example.com: https://github.com
Going to open https://github.com...
Ready to record. You can do any interaction on the page.
Once you want to finish the recording, enter 'y' to start replay:
```

At this point, you can interact on the web page. After the desired operations have been recorded, enter 'y' on the CLI, and the test tool will replay the operations to verify whether the recording was successful.

The following messages will be printed on the CLI during replay:

```
Enter 'y' to persistently store these recorded events:
```

At this point, you can enter 'y' again on the CLI. The test tool will save the recorded session into a static HTML file and prompt for the location:

```
Saved at PATH_TO_YOUR_REPO/temp/replay_2018_11_23T07_53_30.html
```

This file uses the latest rrweb bundle code, so we can run `npm run bundle:browser` after patching the code, then refresh the static file to see and debug the impact of the latest code on replay.
