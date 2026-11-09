import type { eventWithTime } from '@rrweb/types';
import { record } from 'rrweb';
import type { recordOptions } from 'rrweb';
import {
  getRecordKeydownPlugin,
  type KeydownRecordOptions,
} from '../../src/index';

document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML =
  '<input type="password" />';

const snapshots: eventWithTime[] = ((window as any).snapshots = []);
(window as any).mirror = record.mirror;
(window as any).startRecording = (
  options?: Partial<KeydownRecordOptions>,
  recorderOptions?: recordOptions<eventWithTime>,
) => {
  (window as any).stopRecording = record({
    ...recorderOptions,
    emit: (event) => {
      snapshots.push(event);
    },
    plugins: [getRecordKeydownPlugin(options)],
  });
};
