# Keydown Recorder

rrweb records typed text as input events, but not the keys themselves. This plugin records the key presses that leave no input event: Enter, Tab, Escape, arrow and function keys, and shortcuts such as Control+A.

## Enable Keydown Recording

```js
import { record } from '@rrweb/record';
import { getRecordKeydownPlugin } from '@rrweb/rrweb-plugin-keydown-record';

record({
  emit: function emit(event) {
    events.push(event);
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
      id: 42, // node id of the focused element
      key: 'a',
      code: 'KeyA',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    },
  },
  timestamp: 1700000000000,
}
```

## Options

| key             | default | description                                                                                                                 |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| recordPrintable | false   | Also record keys that type a character. They are left out wherever the recorder masks input, and always in password fields. |

Key presses follow the recorder's own [privacy](../../guide.md#privacy) settings: none are recorded on elements it blocks or ignores.
Modifier keys pressed on their own and key presses during IME composition are never recorded.
