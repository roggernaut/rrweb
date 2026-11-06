# @rrweb/rrweb-plugin-keydown-record

Records keydown events that rrweb core does not capture: Enter, Tab, Escape, arrow and function keys, and shortcuts such as Control+A. Each event carries the rrweb node id of the focused element.
See the [keydown recipe](../../../docs/recipes/keydown.md) and the [guide](../../../guide.md) for more info on rrweb.

## Installation

```bash
npm install @rrweb/rrweb-plugin-keydown-record
```

## Usage

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

Printable keys pressed without Control, Alt or Meta are not recorded by default. Typed text already reaches the recording through input events, where rrweb's masking applies; recording printable keydowns would be an unmasked copy of it. `recordPrintable: true` opts in, except on password fields.
