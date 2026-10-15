import type { eventWithTime } from '@rrweb/types';
import { record } from 'rrweb';
import { getRecordKeydownPlugin } from '../../src/index';

const snapshots: eventWithTime[] = ((window as any).snapshots = []);
(window as any).mirror = record.mirror;
const params = new URLSearchParams(window.location.search);
record({
  emit: (event) => {
    snapshots.push(event);
  },
  plugins: [
    getRecordKeydownPlugin({
      recordPrintable: params.get('recordPrintable') === 'true',
    }),
  ],
});
