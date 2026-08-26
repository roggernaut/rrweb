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

| key                      | default            | description                                                                                                                                                                                   |
| ------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| emit                     | required           | the callback function to get emitted events                                                                                                                                                   |
| checkoutEveryNth         | -                  | take a full snapshot after every N events<br />refer to the [checkout](#checkout) chapter                                                                                                     |
| checkoutEveryNms         | -                  | take a full snapshot after every N ms<br />refer to the [checkout](#checkout) chapter                                                                                                         |
| blockClass               | 'rr-block'         | Use a string or RegExp to configure which elements should be blocked, refer to the [privacy](#privacy) chapter                                                                                |
| blockSelector            | null               | Use a string to configure which selector should be blocked, refer to the [privacy](#privacy) chapter                                                                                          |
| ignoreClass              | 'rr-ignore'        | Use a string or RegExp to configure which elements should be ignored, refer to the [privacy](#privacy) chapter                                                                                |
| ignoreSelector           | null               | Use a string to configure which selector should be ignored, refer to the [privacy](#privacy) chapter                                                                                          |
| ignoreCSSAttributes      | null               | array of CSS attributes that should be ignored                                                                                                                                                |
| maskTextClass            | 'rr-mask'          | Use a string or RegExp to configure which elements should be masked, refer to the [privacy](#privacy) chapter                                                                                 |
| maskTextSelector         | null               | Use a string to configure which selector should be masked, refer to the [privacy](#privacy) chapter                                                                                           |
| unmaskTextSelector       | null               | Use a string to configure which selector's text should never be masked, even under `strict` or a policy `mask` rule; merged with any policy `unmask`/`allow` rules, refer to the [privacy](#privacy) chapter |
| maskAllInputs            | false              | mask all input content as \*                                                                                                                                                                  |
| maskInputOptions         | { password: true } | mask some kinds of input \*<br />refer to the [list](https://github.com/rrweb-io/rrweb/blob/588164aa12f1d94576f89ae0210b98f6e971c895/packages/rrweb-snapshot/src/types.ts#L77-L95)            |
| maskInputFn              | -                  | customize mask input content recording logic                                                                                                                                                  |
| maskTextFn               | -                  | customize mask text content recording logic                                                                                                                                                   |
| privacyPolicy            | -                  | apply a versioned `strict`, `balanced`, or `legacy` privacy policy before values are emitted, refer to the [privacy](#privacy) chapter                                                        |
| slimDOMOptions           | {}                 | remove unnecessary parts of the DOM <br />refer to the [list](https://github.com/rrweb-io/rrweb/blob/588164aa12f1d94576f89ae0210b98f6e971c895/packages/rrweb-snapshot/src/types.ts#L97-L108)  |
| dataURLOptions           | {}                 | Canvas image format and quality ,This parameter will be passed to the OffscreenCanvas.convertToBlob(),Using this parameter effectively reduces the size of the recorded data                  |
| inlineStylesheet         | true               | Deprecated since 2.0.0. Still supported, but planned to be superseded by future `captureAssets` asset recording APIs.                                                                         |
| hooks                    | {}                 | hooks for events<br />refer to the [list](https://github.com/rrweb-io/rrweb/blob/9488deb6d54a5f04350c063d942da5e96ab74075/src/types.ts#L207)                                                  |
| packFn                   | -                  | refer to the [storage optimization recipe](./docs/recipes/optimize-storage.md)                                                                                                                |
| sampling                 | -                  | refer to the [storage optimization recipe](./docs/recipes/optimize-storage.md)                                                                                                                |
| recordCanvas             | false              | Whether to record the canvas element. Available options:<br/>`false`, <br/>`true`                                                                                                             |
| canvasMasking            | -                  | Runtime adapter for masking regions of FPS-captured canvas frames. See Privacy below.                                                                                                         |
| maskAllElementAttributes | false              | Masks every source string attribute in the final serialized representation. This reduces replay fidelity and takes precedence over `maskAttributeFn`.                                         |
| maskAttributeFn          | -                  | Transforms each final serialized string attribute. Portable policy rules are applied afterward and cannot be overridden by this callback.                                                     |
| recordCrossOriginIframes | false              | Whether to record cross origin iframes. rrweb has to be injected in each child iframe for this to work. Available options:<br/>`false`, <br/>`true`                                           |
| recordAfter              | 'load'             | If the document is not ready, then the recorder will start recording after the specified event is fired. Available options: `DOMContentLoaded`, `load`                                        |
| inlineImages             | false              | Deprecated since 2.0.0. Still supported, but planned to be superseded by future `captureAssets` asset recording APIs.                                                                         |
| collectFonts             | false              | whether to collect fonts in the website                                                                                                                                                       |
| userTriggeredOnInput     | false              | whether to add `userTriggered` on input events that indicates if this event was triggered directly by the user or not. [What is `userTriggered`?](https://github.com/rrweb-io/rrweb/pull/495) |
| plugins                  | []                 | load plugins to provide extended record functions. [What are plugins?](./docs/recipes/plugin-api.md)                                                                                          |
| errorHandler             | -                  | A callback that is called if something inside of rrweb throws an error. The callback receives the error as argument.                                                                          |

#### Privacy

The existing rrweb masking options are always available and are exactly what
you get by default (the `legacy` preset, below):

- An element with the class name `.rr-block` will not be recorded. Instead, it will replay as a placeholder with the same dimension.
- An element with the class name `.rr-ignore` will not record its input events.
- All text of elements with the class name `.rr-mask` and their children will be masked.
- `input[type="password"]` will be masked by default.
- Mask options to mask the content in input elements.

For a consistent policy across text, inputs, attributes, and URLs, pass a
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
        action: 'unmask', // alias: 'allow'
      },
      {
        target: { type: 'selector', selector: '.private' },
        action: 'mask',
      },
      {
        target: { type: 'selector', selector: '.payment-widget' },
        action: 'exclude',
      },
    ],
    url: {
      blockedQueryParameters: ['token', 'session'],
    },
  },
});
```

`preset` compiles to the following, on top of the `rules` above:

| preset               | behavior                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `legacy` (default)   | Inert: only the existing masking options above apply. `rules` still work (below), but the `data-privacy` attribute and cross-vendor class recognition described below are off.                                                                                                                                                                                                               |
| `balanced`           | Masks every input value (like `maskAllInputs: true`); masks the `title`, `placeholder`, and `aria-label` attributes on every element; sanitizes URLs -- strips `username`/`password` (userinfo), removes the value of any query parameter in a default sensitive list (`access_token`, `auth`, `code`, `key`, `password`, `secret`, `session`, `token`) plus any configured `url.blockedQueryParameters`, and removes the hash unless `url.removeHash: false`. Query parameter names stay visible. Page text is untouched. |
| `strict`             | Everything `balanced` does, plus: all page text is masked; media element sources (`<img>`, `<video>`, `<audio>`, `<iframe>`, `<embed>`, `<object>`, `<source>`) are dropped instead of captured; canvas recording is disabled outright, even with a `canvasMasking` adapter configured; and URL sanitization blocks *every* query parameter's value unless you also set `url.allowedQueryParameters` to an explicit allow-list.                                                            |

CSS is never masked, on any preset or code path: `style`/`_cssText`
attributes and `<style>` element text are exempt from every masking branch,
including live `characterData` mutations.

Rules (`rules: [{ target: { type: 'selector', selector }, action }]`) accept
`mask`, `unmask` (an alias of `allow`), or `exclude`, and work under every
preset, including `legacy`. For text, the nearest matching ancestor decides,
walking from the node up to the document root; if the very same element
matches both a mask and an unmask selector, unmask wins there. `exclude`
removes a subtree from capture entirely (it replays as a placeholder), which
is why an `exclude` decision can't be reopened by a nested `mask` or `unmask`.
Protected inputs -- password, hidden, and autocomplete `cc-*` /
`current-password` / `new-password` / `one-time-code` fields -- always stay
masked, regardless of any rule or preset. This holds even with no
`privacyPolicy` configured at all, and regardless of `maskInputOptions` --
these fields cannot be opted back into raw recording. (Previously, under
`legacy`, `hidden` inputs and autocomplete-tagged credit-card/password/OTP
fields could record their raw value; that is a breaking change from pre-v2
behavior.)

Under `balanced` and `strict`, rrweb also recognizes the vendor-neutral
`data-privacy` attribute and common cross-vendor class names directly in
markup, no extra configuration required:

```html
<section data-privacy="exclude">Never capture this subtree</section>
<section data-privacy="mask">Mask content in this subtree</section>
<span data-privacy="allow">This content may be captured</span>
```

- Mask: `.rr-mask`, `.mp-mask`, `.fs-mask`, `.amp-mask`, `.ph-mask`, `.sentry-mask`, `[data-sentry-mask]`
- Unmask: `.rr-unmask`, `.amp-unmask`, `.sentry-unmask`, `[data-sentry-unmask]`
- Block: `.rr-block`, `.mp-block`, `.fs-exclude`, `.amp-block`, `.ph-no-capture`, `.sentry-block`

(`.rr-mask` and `.rr-block` also work under `legacy`, through the existing
`maskTextClass`/`blockClass` options above -- the rest of this list is new in
`balanced`/`strict`.) `data-privacy` values are case-sensitive; an unknown
value makes no decision and the element inherits from its nearest valid
ancestor.

> Under `legacy`, `data-privacy="mask"`/`data-privacy="exclude"` are each
> only recognized once you also supply at least one selector-based `mask`/
> `exclude` rule (of that same action) in `rules`; `data-privacy="allow"` is
> never recognized under `legacy`, with or without rules. This asymmetry is a
> corner of the current implementation, not something to design around --
> switch to `balanced`/`strict` for unconditional `data-privacy` support.

`unmaskTextSelector` is a `record()`-level escape hatch for text: a plain CSS
selector (merged with any policy `unmask`/`allow` rule selectors) that stays
unmasked even under `strict`'s mask-everything default or a `mask` rule. It
only affects text masking -- it cannot unmask input values, the
`title`/`placeholder`/`aria-label` attributes, or a sanitized URL, and it
cannot override a protected input or an `exclude`.

An invalid `maskTextSelector` or `unmaskTextSelector` -- either this
`record()`-level string option or a policy rule's selector -- fails closed:
rather than being silently ignored (as if it had never been set), it causes
the affected text to be masked. Prefer a selector you've verified with
`document.querySelector` over trusting this as a validation mechanism.

```js
record({
  privacyPolicy: { version: 1, preset: 'strict' },
  unmaskTextSelector: '.support-widget',
});
```

Heuristic PII detection (email, phone, Luhn-valid payment card, SSN-like,
IPv4) is never implied by a preset. Opt in with
`@rrweb/rrweb-plugin-privacy-detectors` (or its `applyPrivacyDetectors`
helper), which masks the whole value when a detector matches -- there is no
character-range masking and no support for custom detector patterns.
Detection scans page text nodes and form input values, both at
snapshot time and on later live updates (text mutations and input events).
It only applies to values that would otherwise be recorded unmasked -- text
or inputs already masked by a preset, selector, or legacy option keep that
masking (including a trusted legacy `maskTextFn`/`maskInputFn` output).
Attribute values are not scanned; use the presets' masked-attribute defaults
or policy rules for those.

```js
import { getRecordPrivacyDetectorsPlugin } from '@rrweb/rrweb-plugin-privacy-detectors';

record({
  emit(event) {
    // store event
  },
  plugins: [getRecordPrivacyDetectorsPlugin()],
});
```

Once loaded, detectors run independently of the active preset -- including
`legacy` -- on top of whatever masking that preset already applies.

For unusual attribute-bearing applications, `maskAllElementAttributes` is the
coarse fail-closed option and `maskAttributeFn(name, value, element)` is the
targeted escape hatch. `maskAllElementAttributes` and `maskAttributeFn` are
mutually exclusive: if both are supplied, `maskAllElementAttributes` wins and
`maskAttributeFn` is ignored, with a one-time console warning. A throwing
`maskAttributeFn` fails closed to stars rather than leaking the original
value. Under `legacy`, `maskAttributeFn`'s return value is used as-is; under
`balanced`/`strict` the compiled policy still runs on top of it (URL
sanitization, `title`/`placeholder`/`aria-label` masking, ...) and can only
narrow what the callback chose to keep, never restore something the policy
would otherwise mask. `style`/`_cssText` are exempt from all of this.
Likewise, under `legacy`, `maskInputFn`'s return value is trusted verbatim;
under `balanced`/`strict`, `maskInputFn` output is star-replaced -- the
callback controls length, never content.

Canvas applications can provide capture-time regions when using FPS canvas
sampling. Coordinates are CSS pixels relative to the canvas. Return `[]` when
the frame is safe unchanged, or `null`/`undefined` when regions cannot be
computed; rrweb skips unanswerable frames. Invalid rectangles and thrown
errors also fail closed. Configuring `canvasMasking` at all forces
`sampling.canvas` onto the FPS/OffscreenCanvas capture path (defaulting to
`4` if you haven't already set a number), since that's the only capture path
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
