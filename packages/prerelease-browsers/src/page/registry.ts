import { builtinChecks } from './checks/builtins.ts';
import { cssChecks } from './checks/css.ts';
import { domChecks } from './checks/dom.ts';
import { inputChecks } from './checks/inputs.ts';
import { mediaChecks } from './checks/media.ts';
import { perfChecks } from './checks/perf.ts';
import { privacyChecks } from './checks/privacy.ts';
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
    run() {
      const prefix = '{"ok":true,"message":"';
      // The emoji's high surrogate is the last unit of the first read chunk.
      return Promise.resolve({
        ok: true,
        message: 'a'.repeat(199_999 - prefix.length) + '😀' + 'z',
      });
    },
  },
  {
    id: 'test-throws',
    kind: 'functional',
    tier: 'focused',
    run() {
      return Promise.reject(new Error('boom'));
    },
  },
  {
    id: 'test-load-error',
    kind: 'functional',
    tier: 'focused',
    beforeRrweb() {
      throw new Error('early boom');
    },
    run() {
      return Promise.resolve({ ok: true });
    },
  },
  {
    id: 'test-start-deferred',
    kind: 'functional',
    tier: 'focused',
    run() {
      window.__prerelease_test_ran = true;
      return Promise.resolve({ ok: true });
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
  ...cssChecks,
  ...builtinChecks,
  ...domChecks,
  ...inputChecks,
  ...mediaChecks,
  ...privacyChecks,
  ...perfChecks,
  ...(typeof window !== 'undefined' && window.__prerelease_test === true
    ? protocolTestChecks
    : []),
];

export function findCheck(id: string): CheckDefinition | undefined {
  return checks.find((check) => check.id === id);
}
