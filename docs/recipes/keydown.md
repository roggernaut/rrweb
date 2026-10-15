# Keydown Recorder

rrweb records typed text as input events, which carry the field's resulting value and respect the masking options. It does not record the keys themselves, so Enter, Tab, Escape, arrow keys and shortcuts such as Control+A are invisible in a recording. The keydown plugin fills that gap. Its events are useful for reproducing keyboard-driven flows and for turning recordings into end-to-end test scripts.

## Enable Keydown Recording

```js
import { record } from '@rrweb/record';
import { getRecordKeydownPlugin } from '@rrweb/rrweb-plugin-keydown-record';

record({
  emit: function emit(event) {
    // send events to server
  },
  plugins: [getRecordKeydownPlugin()],
});
```

Each key press is emitted as a plugin event:

```js
{
  type: EventType.Plugin,
  data: {
    plugin: 'rrweb/keydown@1',
    payload: {
      key: 'a',
      code: 'KeyA',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      targetId: 42, // rrweb node id of the focused element, or null
    },
  },
  timestamp: 1700000000000,
}
```

## Options

| key             | default                        | description                                                                                                                                                             |
| --------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| recordPrintable | false                          | Also record printable keys pressed without Control, Alt or Meta. Off by default because this would be an unmasked copy of typed text. Never applies to password fields. |
| ignoreSelector  | `.rr-ignore, [data-rr-ignore]` | Key presses targeting a matching element, or an element inside one, are not recorded.                                                                                   |

Bare modifier presses (Control, Alt, Shift, Meta on their own) and keydowns during IME composition are never recorded.
