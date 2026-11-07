import { builtinChecks } from './checks/builtins.ts';
import { cssChecks, runEarlyLinkedStylesheet } from './checks/css.ts';
import { domChecks } from './checks/dom.ts';
import { inputChecks } from './checks/inputs.ts';
import { mediaChecks } from './checks/media.ts';
import { perfChecks } from './checks/perf.ts';
import { privacyChecks } from './checks/privacy.ts';
import type { CheckContext, CheckDefinition } from './harness.ts';

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

/**
 * Variants that break or probe the harness on purpose, to prove a check or
 * the harness itself notices; registered only under test.
 */
const harnessTestChecks: CheckDefinition[] = [
  {
    // css-early-linked-stylesheet against a recorder that never inlines
    // stylesheets: it must fail.
    id: 'test-early-stylesheet-not-inlined',
    kind: 'functional',
    tier: 'full',
    needsHttp: true,
    run: (ctx) => runEarlyLinkedStylesheet(ctx, { inlineStylesheet: false }),
  },
  {
    // A link that loads after the snapshot: the Replayer writes the
    // mutation's _cssText into the node it built from the snapshot.
    id: 'test-replay-keeps-events',
    kind: 'functional',
    tier: 'focused',
    async run(ctx) {
      const t = Date.now();
      const el = (id: number, tagName: string, childNodes: unknown[] = []) => ({
        type: 2 /* Element */,
        id,
        tagName,
        attributes: {},
        childNodes,
      });
      const link = {
        ...el(4, 'link'),
        attributes: { rel: 'stylesheet', href: 'data:text/css,' },
      };
      const events = [
        {
          type: 4 /* Meta */,
          data: { href: location.href, width: 800, height: 600 },
          timestamp: t,
        },
        {
          type: 2 /* FullSnapshot */,
          data: {
            node: {
              type: 0 /* Document */,
              id: 1,
              childNodes: [
                el(2, 'html', [el(3, 'head', [link]), el(5, 'body')]),
              ],
            },
            initialOffset: { left: 0, top: 0 },
          },
          timestamp: t + 1,
        },
        {
          type: 3 /* IncrementalSnapshot */,
          data: {
            source: 0 /* Mutation */,
            texts: [],
            attributes: [{ id: 4, attributes: { _cssText: 'p{color:red}' } }],
            removes: [],
            adds: [],
          },
          timestamp: t + 2,
        },
      ] as unknown as Parameters<CheckContext['replay']>[0];
      const before = JSON.stringify(events);
      const doc = await ctx.replay(events);
      if (!doc.querySelector('style')) {
        return { ok: false, message: 'replay did not apply the _cssText' };
      }
      return JSON.stringify(events) === before
        ? { ok: true }
        : { ok: false, message: 'replay changed the recorded events' };
    },
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
    ? [...protocolTestChecks, ...harnessTestChecks]
    : []),
];

export function findCheck(id: string): CheckDefinition | undefined {
  return checks.find((check) => check.id === id);
}
