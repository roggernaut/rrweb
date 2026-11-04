import { EventType, IncrementalSource, MouseInteractions } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';

const now = Date.now();
const touch = (
  type: MouseInteractions,
  pointerId: number,
  x: number,
  y: number,
  offset: number,
): eventWithTime => ({
  type: EventType.IncrementalSnapshot,
  data: {
    source: IncrementalSource.MouseInteraction,
    type,
    id: 5,
    x,
    y,
    pointerId,
  },
  timestamp: now + offset,
});

/**
 * A pinch with two fingers, a tap that gets cancelled by the browser, then a
 * tap while pinch-zoomed in.
 */
const events: eventWithTime[] = [
  {
    type: EventType.DomContentLoaded,
    data: {},
    timestamp: now,
  },
  {
    type: EventType.Load,
    data: {},
    timestamp: now + 100,
  },
  {
    type: EventType.Meta,
    data: {
      href: 'http://localhost',
      width: 400,
      height: 600,
    },
    timestamp: now + 100,
  },
  {
    data: {
      node: {
        id: 1,
        type: 0,
        childNodes: [
          { id: 2, name: 'html', type: 1, publicId: '', systemId: '' },
          {
            id: 3,
            type: 2,
            tagName: 'html',
            attributes: { lang: 'en' },
            childNodes: [
              {
                id: 4,
                type: 2,
                tagName: 'head',
                attributes: {},
                childNodes: [],
              },
              {
                id: 5,
                type: 2,
                tagName: 'body',
                attributes: {},
                childNodes: [],
              },
            ],
          },
        ],
      },
      initialOffset: { top: 0, left: 0 },
    },
    type: EventType.FullSnapshot,
    timestamp: now + 100,
  },
  touch(MouseInteractions.TouchStart, 0, 100, 300, 1000),
  touch(MouseInteractions.TouchStart, 1, 200, 300, 1100),
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.TouchMove,
      pointerId: 1,
      positions: [
        { x: 220, y: 300, id: 5, timeOffset: -100 },
        { x: 240, y: 300, id: 5, timeOffset: 0 },
      ],
    },
    timestamp: now + 1300,
  },
  touch(MouseInteractions.TouchEnd, 1, 240, 300, 1500),
  touch(MouseInteractions.TouchEnd, 0, 100, 300, 1600),
  touch(MouseInteractions.TouchStart, 0, 150, 450, 2000),
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.MouseInteraction,
      type: MouseInteractions.TouchCancel,
      id: 5,
      x: 150,
      y: 450,
    },
    timestamp: now + 2100,
  },
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.VisualViewport,
      scale: 2,
      offsetLeft: 50,
      offsetTop: 100,
    },
    timestamp: now + 3000,
  },
  touch(MouseInteractions.TouchStart, 0, 150, 200, 3100),
  touch(MouseInteractions.TouchEnd, 0, 150, 200, 3200),
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.VisualViewport,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
    },
    timestamp: now + 3500,
  },
];

export default events;
