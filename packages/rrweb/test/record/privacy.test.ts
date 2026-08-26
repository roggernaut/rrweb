/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import record from '../../src/record';
import type { RecordPlugin } from '@rrweb/types';

describe('record() privacy policy plugin fallback', () => {
  it('a plugin returning a malformed policy falls back to the user policy instead of throwing', () => {
    const badPlugin: RecordPlugin = {
      name: 'bad@1',
      applyPrivacyPolicy: () => ({ nonsense: true }) as never,
    };

    let stop: (() => void) | undefined;
    expect(() => {
      stop = record({ emit: () => {}, plugins: [badPlugin] });
    }).not.toThrow();
    stop?.();
  });

  it('still throws when the user supplies their own invalid policy directly (no plugin involved)', () => {
    expect(() => {
      record({
        emit: () => {},
        // @ts-expect-error intentionally invalid for this test
        privacyPolicy: { nonsense: true },
      });
    }).toThrow();
  });
});
