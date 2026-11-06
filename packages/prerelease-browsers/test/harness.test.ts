import type { eventWithTime } from '@rrweb/types';
import { createContext } from '../src/page/harness.ts';

/** createContext reads window.rrweb; assertPrivate needs nothing else. */
function context() {
  vi.stubGlobal('window', { rrweb: {} });
  try {
    return createContext({});
  } finally {
    vi.unstubAllGlobals();
  }
}

const events = (text: string) =>
  [{ type: 3, data: { text }, timestamp: 0 }] as unknown as eventWithTime[];

describe('assertPrivate', () => {
  test('a leak is a privacy failure', () => {
    const result = context().assertPrivate(
      events('SECRET PUBLIC'),
      ['SECRET'],
      ['PUBLIC'],
    );
    expect(result).toMatchObject({
      ok: false,
      message: 'privacy leak: SECRET',
    });
    expect(result.kind).toBeUndefined();
  });

  test('a leak wins over a missing control', () => {
    const result = context().assertPrivate(
      events('SECRET'),
      ['SECRET'],
      ['PUBLIC'],
    );
    expect(result.message).toBe('privacy leak: SECRET');
    expect(result.kind).toBeUndefined();
  });

  test('a missing public control is a functional failure', () => {
    const result = context().assertPrivate(events(''), ['SECRET'], ['PUBLIC']);
    expect(result).toMatchObject({
      ok: false,
      kind: 'functional',
      message: 'public control missing: PUBLIC',
    });
  });

  test('no leak and every control present passes', () => {
    const result = context().assertPrivate(
      events('PUBLIC'),
      ['SECRET'],
      ['PUBLIC'],
    );
    expect(result).toMatchObject({ ok: true });
    expect(result.kind).toBeUndefined();
  });
});
