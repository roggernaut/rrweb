import { domChecks } from './checks/dom.ts';
import type { CheckDefinition } from './harness.ts';

declare global {
  interface Window {
    /** Set by tests in meta.head, before the bundle runs. */
    __prerelease_test?: boolean;
    /** Set by test-start-deferred the moment its run begins. */
    __prerelease_test_ran?: boolean;
  }
}

/** Checks that exercise the protocol itself; registered only under test. */
const protocolTestChecks: CheckDefinition[] = [
  {
    id: 'test-surrogate-boundary',
    kind: 'functional',
    tier: 'focused',
    async run() {
      const prefix = '{"ok":true,"message":"';
      // The emoji's high surrogate is the last unit of the first read chunk.
      return {
        ok: true,
        message: 'a'.repeat(199_999 - prefix.length) + '😀' + 'z',
      };
    },
  },
  {
    id: 'test-throws',
    kind: 'functional',
    tier: 'focused',
    async run() {
      throw new Error('boom');
    },
  },
  {
    id: 'test-load-error',
    kind: 'functional',
    tier: 'focused',
    beforeRrweb() {
      throw new Error('early boom');
    },
    async run() {
      return { ok: true };
    },
  },
  {
    id: 'test-start-deferred',
    kind: 'functional',
    tier: 'focused',
    async run() {
      window.__prerelease_test_ran = true;
      return { ok: true };
    },
  },
  {
    id: 'test-hangs',
    kind: 'functional',
    tier: 'focused',
    run: () => new Promise(() => undefined),
  },
];

/** Every check, in run order. */
export const checks: CheckDefinition[] = [
  ...domChecks,
  ...(typeof window !== 'undefined' && window.__prerelease_test === true
    ? protocolTestChecks
    : []),
];

export function findCheck(id: string): CheckDefinition | undefined {
  return checks.find((check) => check.id === id);
}
