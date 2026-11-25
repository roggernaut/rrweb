# rrweb-player

## Overview

Use this package to get a feature-rich playback UI out of the box; if you want to build your own UI use the [@rrweb/replay](../../packages/replay/README.md) package.

This is the same replayer used in the [cloud dashboard](https://app.rrweb.com/), if you want to try out a replay of your website, you can sign up and make a quick recording using the 'Test record any webpage' bookmarklet.

## How is this different from `new Replayer()`?

`new Replayer()` is from the more foundational [@rrweb/replay](../../packages/replay/README.md) package, which renders and rebuilds an rrweb event stream within an iframe. This package builds on that to provide UI in the form of play/pause controls and a timeline using the [Svelte](https://svelte.dev/) UI framework. The similar naming is unfortunate, and we aim to fix that in a future major version.

## Installation

### 1) Bundler / npm (Recommended)

```shell
npm install rrweb-player
```

```js
import rrwebPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
```

### 2) Browser Without Bundler (ESM)

```html
<link
  rel="stylesheet"
  href="https://cdn.rrweb.com/rrweb-player/current/style.css"
/>
<script type="module">
  import rrwebPlayer from 'https://cdn.rrweb.com/rrweb-player/current/rrweb-player.js';
</script>
```

Use `current` for the latest stable release, or pin an exact version such as
`https://cdn.rrweb.com/rrweb-player/2.0.0/rrweb-player.js` for immutable
production URLs. See the [CDN assets docs](https://rrweb.com/docs/cloud/cdn-assets)
for the full URL shape and catalog.

### 3) Legacy Direct `<script>` Include (UMD fallback)

Use this only for compatibility with non-module environments.

```html
<link
  rel="stylesheet"
  href="https://cdn.rrweb.com/rrweb-player/current/style.css"
/>
<script src="https://cdn.rrweb.com/rrweb-player/current/rrweb-player.umd.cjs"></script>
```

## Usage

```js
new rrwebPlayer({
  target: document.body, // customizable root element
  props: {
    events,
  },
});
```

## Options

| key                 | default          | description                                                                                                       |
| ------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| events              | []               | the events for replaying                                                                                          |
| width               | 1024             | the width of the replayer                                                                                         |
| height              | 576              | the height of the replayer                                                                                        |
| maxScale            | 1                | the maximum scale of the replayer (1 = 100%), set to 0 for unlimited                                              |
| autoPlay            | true             | whether to autoplay                                                                                               |
| speed               | 1                | The default speed to play at                                                                                      |
| speedOption         | [1, 2, 4, 8]     | speed options in UI                                                                                               |
| showCaptions        | true             | Whether to show timed captions initially                                    |
| showController      | true             | whether to show the controller UI                                                                                 |
| timelineMarkerColor | rgb(73, 80, 246) | color of timeline marker annotations                                                                              |
| tags                | {}               | customize the custom events style with a key-value map                                                            |
| inactiveColor       | #D4D4D4          | Customize the color of inactive periods indicator in the progress bar with a valid CSS color string.              |
| ...                 | -                | all the [rrweb Replayer options](https://github.com/rrweb-io/rrweb/blob/main/guide.md#options-1) will be bypassed |

## Playback controls

Use `features.jump` to set the jump distance in seconds. The default is 10.
Its `keyboard` option accepts `'page'` (the default), `'player'` for the
focused replay surface or player, and `'off'`. Set `features.jump: false` to disable
jumps, or `controls.jump: false` to hide the jump buttons while keeping
keyboard and programmatic jumps available. Set `features.clickToPlay: false`
to turn off play/pause clicks on the replay surface.

```js
const player = new rrwebPlayer({
  target: document.body,
  props: { events, features: { jump: { seconds: 5, keyboard: 'player' } } },
});

const unsubscribe = player.addEventListener('ui-jump', ({ fromMs, toMs, source }) => {
  console.log(fromMs, toMs, source);
});
player.jump('forward');
player.setFeatures({ jump: { seconds: 15 } }); // retains keyboard: 'player'
unsubscribe();
```

Jump events use replay offsets in milliseconds and identify the source as
`'button'`, `'keyboard'`, or `'api'`. Use `icons['jump-back']` or
`icons['jump-forward']` to supply custom artwork. Each callback receives
`{ name, seconds, document }` and returns an SVG element created with that
document. Buttons retain their accessible names. Use `[data-rrweb-part="timeline"]`
or `[data-rrweb-control="jump-forward"]` for CSS selectors that target a
specific part or control.

Set the player's colors on its mounting element. CSS custom properties inherit
into each player, so two players on the same page can use different themes.

```css
.customer-replay {
  --rrweb-player-surface: #142036;
  --rrweb-player-text: #f5f8ff;
  --rrweb-player-accent: #71d9cc;
  --rrweb-player-focus-ring: #ffcd70;
}
```

Use `--rrweb-player-track` for the timeline background and
`--rrweb-player-played` for its elapsed portion. The popover background uses
`--rrweb-player-popover` and selected buttons use `--rrweb-player-selected`.

Set `controls.play`, `controls.time`, `controls.speed`,
`controls.settings`, or `controls.fullscreen` to `false` to hide individual
toolbar controls. Set `features.fullscreen: false` to disable fullscreen.
The `icons` option also accepts `play`, `pause`, `speed`, `settings`,
`enter-fullscreen`, and `exit-fullscreen`.

## Replay zoom

Zoom is enabled by default. Its scale is relative to the fitted replay, so
`player.setZoom(2)` displays the replay at twice the fitted size. Call
`player.fit()` to return to the fitted size. Viewers can also press Escape
while focus is within the player.

| Option | Default | Behavior |
| --- | --- | --- |
| `features.zoom` | Enabled | Set to `false` to disable zoom. |
| `features.zoom.max` | `4` | Maximum zoom relative to the fitted size. |
| `features.zoom.pan` | `true` | Allow moving around a zoomed replay by dragging or using arrow keys on the viewport. |
| `features.zoom.allowFollow` | `true` | Show the Follow cursor setting and allow the camera to follow the recorded pointer. |
| `features.zoom.followCursor` | `true` | Set the initial state of Follow cursor. |
| `controls.zoom` | `true` | Show the Zoom control. |

Use `player.setFeatures({ zoom: { max: 2, followCursor: false } })` to update
zoom settings on a running player. Lowering the maximum also limits the
current zoom.

## Timeline compression

By default, inactive intervals share at most 20% of the timeline's width.
Set `features.timeline.maxIdleShare` to another fraction or pass
`features.timeline: false` for a linear timeline with idle intervals still marked.
The cap applies to all idle intervals together. Timelines consisting entirely of
idle time stay linear so the full recording is seekable. Markers, the playhead,
and pointer seeking use the same scale. Playback time, progress events, and
`goto()` continue to use recording time.

Set `--rrweb-player-timeline-idle` on the player or a parent to color the idle
intervals. The `inactiveColor` prop provides the fallback color.

## Activity graph

The graph appears near the bottom of the player on hover or when the timeline
receives keyboard focus. Its bands show input-event counts, scroll distance, and
mouse movement. Each band is scaled to its own peak, while the click lane marks
recorded click times. The graph and timeline share the same scale.

| Option | Behavior |
| --- | --- |
| `features.activity: false` | Hides the graph and Timeline layers control. |
| `features.activity.allowedLayers` | Limits the graph and switches to the listed layers. Defaults to all four. |
| `features.activity.initialLayers` | Selects which allowed layers start enabled. Defaults to all allowed layers. An empty array starts with the graph hidden and leaves the viewer able to turn layers on. |
| `features.activity.seek: false` | Displays activity without graph seeking. The regular timeline remains seekable. |
| `controls.activity: false` | Hides the Timeline layers control. |

Layer names are `inputs`, `scroll`, `mouse`, and `clicks`. To set graph and
legend colors, define the matching CSS custom properties on the player or a
parent. The properties are `--rrweb-player-activity-inputs`,
`--rrweb-player-activity-scroll`, `--rrweb-player-activity-mouse`, and
`--rrweb-player-activity-clicks`.

## Captions and timeline markers

Use `record.addAnnotation()` to add captions and timeline markers. Captions are
shown by default. Set `showCaptions: false` to hide initial captions. Viewers
can toggle captions and annotation markers together in Replay settings. The
Annotations switch appears when the recording includes captions or annotation
markers. Custom event markers remain visible when annotations are turned off.

```js
record.addAnnotation({ type: 'caption', text: 'Click Save.' });
record.addAnnotation({
  type: 'timelineMarker',
  text: 'Saving also creates a default workspace.',
});
record.addAnnotation({ type: 'caption', text: '' });
```

Captions persist until replaced or cleared with `''` or `false`.
`timelineMarkerColor` controls annotation marker colors independently of custom
event `tags`. Text is plain text; HTML is not interpreted.

Tab to the playback position slider to seek with the arrow keys in five-second
steps, or use Home/End to jump to the start/end.

See the [annotation recipe](../../docs/recipes/annotations.md)
for replay callbacks, keyboard interactions, seeking, and TypeScript usage.

## Updating inactivity settings

Call `setInactivity` with the options you want to change. During playback,
the replayer applies the changes at the current position.

```ts
player.setInactivity({
  skipInactive: true,
  inactivePeriodThreshold: 15000,
  maxSpeed: 100,
});
```

The threshold is in milliseconds and `maxSpeed` caps the playback speed
during a skip.

Adaptive skipping is enabled by default. Pass `adaptiveSkip: false` as a
constructor prop or call `player.setInactivity({ adaptiveSkip: false })` to
use the classic skip speed.

The skip indicator appears during fast-forward even when `showController` is
`false`. Set `showSkipIndicator: false` to hide it. Style the indicator with
`[data-rrweb-part="skip-indicator"]` or the CSS properties
`--rrweb-player-skip-overlay`, `--rrweb-player-skip-indicator-background`
and `--rrweb-player-skip-indicator-color`.

## Methods on the rrwebPlayer component

```ts
addEventListener(event: string, handler: (params: any) => unknown): void;
```

```ts
addEvent(event: eventWithTime): void;
```

```ts
getMetaData() => {
    startTime: number;
    endTime: number;
    totalTime: number;
}
```

```ts
getReplayer() => Replayer;
```

```ts
getMirror() => Mirror;
```

Toggles between play/pause

```ts
toggle();
```

Sets speed of player

```ts
setSpeed(speed: number)
```

Turns on/off skip inactive

```ts
toggleSkipInactive();
```

Triggers resize, do this whenever you change width/height

```ts
triggerResize();
```

Plays replay

```ts
play();
```

Pauses replay

```ts
pause();
```

Go to a point in time and pause or play from then

```ts
goto(timeOffset: number, play?: boolean)
```

Plays from a time to a time and (optionally) loop

```ts
playRange(
    timeOffset: number,
    endTimeOffset: number,
    startLooping: boolean = false,
    afterHook: undefined | (() => void) = undefined,
  )
```

## Sponsors

[Become a sponsor](https://opencollective.com/rrweb#sponsor) and get your logo on our README on Github with a link to your site.

### Gold Sponsors 🥇

<div dir="auto">

<a href="https://opencollective.com/rrweb/tiers/gold-sponsor/0/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/gold-sponsor/0/avatar.svg?requireActive=false&avatarHeight=225" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/gold-sponsor/1/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/gold-sponsor/1/avatar.svg?requireActive=false&avatarHeight=225" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/gold-sponsor/2/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/gold-sponsor/2/avatar.svg?requireActive=false&avatarHeight=225" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/gold-sponsor/3/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/gold-sponsor/3/avatar.svg?requireActive=false&avatarHeight=225" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/gold-sponsor/4/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/gold-sponsor/4/avatar.svg?requireActive=false&avatarHeight=225" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/gold-sponsor/5/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/gold-sponsor/5/avatar.svg?requireActive=false&avatarHeight=225" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/gold-sponsor/6/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/gold-sponsor/6/avatar.svg?requireActive=false&avatarHeight=225" alt="sponsor"></a>

</div>

### Silver Sponsors 🥈

<div dir="auto">

<a href="https://opencollective.com/rrweb/tiers/silver-sponsor/0/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/silver-sponsor/0/avatar.svg?requireActive=false&avatarHeight=158" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/silver-sponsor/1/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/silver-sponsor/1/avatar.svg?requireActive=false&avatarHeight=158" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/silver-sponsor/2/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/silver-sponsor/2/avatar.svg?requireActive=false&avatarHeight=158" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/silver-sponsor/3/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/silver-sponsor/3/avatar.svg?requireActive=false&avatarHeight=158" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/silver-sponsor/4/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/silver-sponsor/4/avatar.svg?requireActive=false&avatarHeight=158" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/silver-sponsor/5/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/silver-sponsor/5/avatar.svg?requireActive=false&avatarHeight=158" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/silver-sponsor/6/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/silver-sponsor/6/avatar.svg?requireActive=false&avatarHeight=158" alt="sponsor"></a>

</div>

### Bronze Sponsors 🥉

<div dir="auto">

<a href="https://opencollective.com/rrweb/tiers/sponsors/0/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/sponsors/0/avatar.svg?requireActive=false&avatarHeight=70" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/sponsors/1/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/sponsors/1/avatar.svg?requireActive=false&avatarHeight=70" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/sponsors/2/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/sponsors/2/avatar.svg?requireActive=false&avatarHeight=70" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/sponsors/3/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/sponsors/3/avatar.svg?requireActive=false&avatarHeight=70" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/sponsors/4/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/sponsors/4/avatar.svg?requireActive=false&avatarHeight=70" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/sponsors/5/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/sponsors/5/avatar.svg?requireActive=false&avatarHeight=70" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/sponsors/6/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/sponsors/6/avatar.svg?requireActive=false&avatarHeight=70" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/sponsors/7/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/sponsors/7/avatar.svg?requireActive=false&avatarHeight=70" alt="sponsor"></a>
<a href="https://opencollective.com/rrweb/tiers/sponsors/8/website?requireActive=false" target="_blank"><img src="https://opencollective.com/rrweb/tiers/sponsors/8/avatar.svg?requireActive=false&avatarHeight=70" alt="sponsor"></a>

</div>

### Backers

<a href="https://opencollective.com/rrweb#sponsor" rel="nofollow"><img src="https://opencollective.com/rrweb/tiers/backers.svg?avatarHeight=36"></a>

## Core Team Members

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/Yuyz0112">
        <img
          src="https://avatars.githubusercontent.com/u/13651389?s=100"
          width="100px;"
          alt=""
        />
        <br /><sub><b>Yuyz0112</b></sub>
        <br /><br />
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/YunFeng0817">
        <img
          src="https://avatars.githubusercontent.com/u/27533910?s=100"
          width="100px;"
          alt=""
        />
        <br /><sub><b>Yun Feng</b></sub>
        <br /><br />
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/eoghanmurray">
        <img
          src="https://avatars.githubusercontent.com/u/156780?s=100"
          width="100px;"
          alt=""
        />
        <br /><sub><b>eoghanmurray</b></sub>
        <br /><br />
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/Juice10">
        <img
          src="https://avatars.githubusercontent.com/u/4106?s=100"
          width="100px;"
          alt=""
        />
        <br /><sub><b>Juice10</b></sub>
        <br /><sub>open for rrweb consulting</sub>
      </a>
    </td>
  </tr>
</table>

## Who's using rrweb?

<table>
  <tr>
    <td align="center">
      <a href="http://www.smartx.com/" target="_blank">
        <img width="195px" src="https://raw.githubusercontent.com/rrweb-io/web/HEAD/static/logos/smartx.png" alt="SmartX">
      </a>
    </td>
    <td align="center">
      <a href="https://posthog.com?utm_source=rrweb&utm_medium=sponsorship&utm_campaign=open-source-sponsorship" target="_blank">
        <img width="195px" src="https://rrweb.com/posthog.png" alt="PostHog">
      </a>
    </td>
    <td align="center">
      <a href="https://statcounter.com/session-replay/" target="_blank">
        <img width="195px" src="https://statcounter.com/images/logo-statcounter-arc-blue.svg">
      </a>
    </td>
    <td align="center">
      <a href="https://recordonce.com/" target="_blank">
        <img width="195px" alt="Smart screen recording for SaaS" src="https://uploads-ssl.webflow.com/5f3d133183156245630d4446/5f3d1940abe8db8612c23521_Record-Once-logo-554x80px.svg">
      </a>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://sentry.io" target="_blank">
        <img width="195px" src="https://rrweb.com/sentry.png" alt="Sentry">
      </a>
    </td>
    <td align="center">
      <a href="https://www.pendo.io" target="_blank">
        <img width="195px" src="https://rrweb.com/pendo.png" alt="Pendo">
      </a>
    </td>
    <td align="center">
      <a href="https://mixpanel.com" target="_blank">
        <img width="195px" src="https://rrweb.com/mixpanel.png" alt="Mixpanel">
      </a>
    </td>
    <td align="center">
      <a href="https://www.datadoghq.com" target="_blank">
        <img width="195px" src="https://rrweb.com/datadog.png" alt="Datadog">
      </a>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://amplitude.com" target="_blank">
        <img width="195px" src="https://rrweb.com/amplitude.png" alt="Amplitude">
      </a>
    </td>
    <td align="center">
      <a href="https://newrelic.com" target="_blank">
        <img width="195px" src="https://rrweb.com/new%20relic.png" alt="New Relic">
      </a>
    </td>
    <td align="center">
      <a href="https://cux.io" target="_blank">
        <img style="padding: 8px" alt="The first ever UX automation tool" width="195px" src="https://cux.io/cux-logo.svg">
      </a>
    </td>
    <td align="center">
      <a href="https://remsupp.com" target="_blank">
        <img style="padding: 8px" alt="Remote Access & Co-Browsing" width="195px" src="https://remsupp.com/images/logo.png">
      </a>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://highlight.io" target="_blank">
        <img style="padding: 8px" alt="The open source, fullstack Monitoring Platform." width="195px" src="https://github.com/highlight/highlight/raw/main/highlight.io/public/images/logo.png">
      </a>
    </td>
    <td align="center">
      <a href="https://analyzee.io" target="_blank">
        <img style="padding: 8px" alt="Comprehensive data analytics platform that empowers businesses to gain valuable insights and make data-driven decisions." width="195px" src="https://analyzee.io/img/analyzee-main-logo.webp">
      </a>
    </td>
    <td align="center">
      <a href="https://requestly.io" target="_blank">
        <img style="padding: 8px" alt="Intercept, Modify, Record & Replay HTTP Requests." width="195px" src="https://github.com/requestly/requestly/assets/16779465/652552db-c867-44cb-9bb5-94a2026e04ca">
      </a>
    </td>
    <td align="center">
      <a href="https://gleap.io" target="_blank">
        <img style="padding: 8px" alt="In-app bug reporting & customer feedback platform." width="195px" src="https://assets-global.website-files.com/6506f3f29c68b1724807619d/6506f56010237164c6306591_GleapLogo.svg">
      </a>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://uxwizz.com" target="_blank">
        <img style="padding: 8px" alt="Self-hosted website analytics with heatmaps and session recordings." width="195px" src="https://github.com/UXWizz/public-files/raw/main/assets/logo.png">
      </a>
    </td>
    <td align="center">
      <a href="https://www.howdygo.com" target="_blank">
        <img style="padding: 8px" alt="Interactive product demos for small marketing teams" width="195px" src="https://assets-global.website-files.com/650afb446f1dd5bd410f00cc/650b2cec6188ff54dd9b01e1_Logo.svg">
      </a>
    </td>
  </tr>
</table>
