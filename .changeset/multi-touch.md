---
"rrweb": minor
"@rrweb/types": minor
"@rrweb/record": minor
"@rrweb/replay": minor
---

Multi-touch and pinch-zoom:

- Touch events carry an optional `pointerId` (the finger's `Touch.identifier`), and the replayer shows one indicator per finger. Touch start/end are recorded from touch events where available, so the end of a swipe that scrolls the page is recorded too.
- Without the new `recordMultiTouch` option, TouchMove follows one finger (instead of jumping between fingers); with it, every finger's movement is recorded.
- Pinch-zoom is recorded as `IncrementalSource.VisualViewport` (scale and offset of `window.visualViewport`) and replayed by zooming the replay into the same part of the page.

All additions are optional fields or a new event source, so recordings stay compatible with older replayers and older recordings replay unchanged.
