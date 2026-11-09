import type { eventWithTime } from '@rrweb/types';
import { createContext, withPageError } from '../src/page/harness.ts';

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

describe('withPageError', () => {
  test('a pass becomes a failure naming the error', () => {
    expect(withPageError({ ok: true }, 'boom')).toEqual({
      ok: false,
      message: 'page error: boom',
    });
  });
  test('a skip is a failure too: the attempt did not cleanly skip', () => {
    expect(withPageError({ ok: true, skipped: 'x' }, 'boom')).toEqual({
      ok: false,
      message: 'page error: boom',
    });
  });
  test('a leak stays a leak', () => {
    expect(
      withPageError(
        { ok: false, kind: 'privacy', message: 'privacy leak: S' },
        'boom',
      ),
    ).toEqual({
      ok: false,
      kind: 'privacy',
      message: 'privacy leak: S; page error: boom',
    });
  });
});

describe('assertPrivate', () => {
  test('a leak is a privacy failure', () => {
    const result = context().assertPrivate(
      events('SECRET PUBLIC'),
      ['SECRET'],
      ['PUBLIC'],
    );
    expect(result).toMatchObject({
      ok: false,
      kind: 'privacy',
      message: 'privacy leak: SECRET',
    });
  });

  test('every planted canary found is reported', () => {
    const result = context().assertPrivate(events('A B'), ['A', 'B', 'C'], []);
    expect(result.canaries).toEqual({ planted: 3, leaked: ['A', 'B'] });
  });

  test('dropping the masked content is a functional failure', () => {
    const result = context().assertPrivate(
      events('PUBLIC'),
      ['SECRET'],
      ['PUBLIC'],
      {
        maskedAs: ['SECRET'],
      },
    );
    expect(result).toMatchObject({ ok: false, kind: 'functional' });
    expect(result.message).toMatch(/^masked content not recorded/);
  });

  test('a masked run of another length does not count', () => {
    const result = context().assertPrivate(events('*****'), ['SECRET'], [], {
      maskedAs: ['SECRET'],
    });
    expect(result.ok).toBe(false);
  });

  test('the masked form, exactly as long as the value, passes', () => {
    const result = context().assertPrivate(events('******'), ['SECRET'], [], {
      maskedAs: ['SECRET'],
    });
    expect(result.ok).toBe(true);
  });

  test('missing evidence is a functional failure', () => {
    const result = context().assertPrivate(events(''), [], [], {
      evidence: { placeholder: false },
    });
    expect(result).toMatchObject({
      ok: false,
      kind: 'functional',
      message: 'not recorded: placeholder',
    });
  });

  test('a leak wins over a missing control', () => {
    const result = context().assertPrivate(
      events('SECRET'),
      ['SECRET'],
      ['PUBLIC'],
    );
    expect(result.message).toBe('privacy leak: SECRET');
    expect(result.kind).toBe('privacy');
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
