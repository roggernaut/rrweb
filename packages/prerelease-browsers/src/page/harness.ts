import type * as rrwebModule from 'rrweb';
import type { recordOptions } from 'rrweb';
import type { eventWithTime } from '@rrweb/types';
import type { AttemptResult, CheckMeta, RunOptions } from '../types.ts';

type Rrweb = typeof rrwebModule;

declare global {
  interface Window {
    rrweb: Rrweb;
  }
}

export interface Recording {
  /** Waits 2 animation frames + 50 ms, then stops and returns the events. */
  stop(): Promise<eventWithTime[]>;
}

export interface Probe {
  selector: string;
  props: string[];
  shadowHost?: string;
  /**
   * What `props` must compute to on the live page. Otherwise this engine does
   * not apply the CSS under test, and live and replay would agree on nothing.
   */
  liveMustBe?: string[];
}

/** What, besides leaks and public text, a privacy recording must show. */
export interface PrivacyProof {
  /** Values rrweb must have recorded in masked form: one `*` per character. */
  maskedAs?: string[];
  /** Named facts about the recording, such as a blocked element's placeholder. */
  evidence?: Record<string, boolean>;
}

export interface CheckContext {
  rrweb: Rrweb;
  options: Required<RunOptions>;
  record(options?: recordOptions<eventWithTime>): Recording;
  /** Replays into a hidden container, played to the end. */
  replay(events: eventWithTime[]): Promise<Document>;
  compareComputed(
    events: eventWithTime[],
    probes: Probe[],
  ): Promise<AttemptResult>;
  measure<T>(
    fn: () => T | Promise<T>,
  ): Promise<{ value: T; durationMs: number; maxBlockMs: number }>;
  heapBytes(): number | undefined;
  canary(name: string, format?: 'text' | 'digits' | 'email'): string;
  control(name: string): string;
  assertPrivate(
    events: eventWithTime[],
    canaries: string[],
    controls: string[],
    proof?: PrivacyProof,
  ): AttemptResult;
  nextFrame(): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface CheckDefinition extends CheckMeta {
  beforeRrweb?(): void;
  run(ctx: CheckContext): Promise<AttemptResult>;
}

/** Matches nothing, so masking and blocking by class never apply. */
const noClass = '__prerelease_none__';

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * What a recording's stop waits for before it stops: two animation frames,
 * then 50 ms. A page that renders no frames never gets past it.
 */
export async function settleLikeStop(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await sleep(50);
}

function randomDigits(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 10);
  return out;
}

function lookup(doc: Document, probe: Probe): Element | null {
  if (!probe.shadowHost) return doc.querySelector(probe.selector);
  const host = doc.querySelector(probe.shadowHost);
  return host?.shadowRoot?.querySelector(probe.selector) ?? null;
}

function computed(el: Element, props: string[]): string[] {
  const style = el.ownerDocument.defaultView!.getComputedStyle(el);
  return props.map((prop) => style.getPropertyValue(prop));
}

function probeName(probe: Probe): string {
  return probe.shadowHost
    ? `${probe.shadowHost} >>> ${probe.selector}`
    : probe.selector;
}

/**
 * An attempt during which the page threw: it failed, even if the check
 * skipped, and a failure keeps what it found, such as a leak.
 */
export function withPageError(
  outcome: AttemptResult,
  pageError: string,
): AttemptResult {
  const { skipped: _skipped, ...rest } = outcome;
  return {
    ...rest,
    ok: false,
    message: outcome.ok
      ? `page error: ${pageError}`
      : `${outcome.message ?? 'check failed'}; page error: ${pageError}`,
  };
}

export function createContext(runOptions: RunOptions): CheckContext {
  const rrweb = window.rrweb;
  const options: Required<RunOptions> = {
    disableMasking: runOptions.disableMasking ?? false,
    scale: runOptions.scale ?? 1,
  };

  const canaryLengths = new Set<number>();
  const ctx: CheckContext = {
    rrweb,
    options,
    nextFrame,
    sleep,

    record(recordOpts = {}) {
      const events: eventWithTime[] = [];
      let merged: recordOptions<eventWithTime> = {
        ...recordOpts,
        emit(event, isCheckout) {
          events.push(event);
          recordOpts.emit?.(event, isCheckout);
        },
      };
      if (options.disableMasking) {
        const {
          maskTextSelector: _maskTextSelector,
          blockSelector: _blockSelector,
          maskInputFn: _maskInputFn,
          ...rest
        } = merged;
        merged = {
          ...rest,
          maskAllInputs: false,
          maskInputOptions: { password: false },
          maskTextClass: noClass,
          blockClass: noClass,
        };
      }
      const stopFn = rrweb.record(merged);
      if (!stopFn) throw new Error('rrweb.record did not start');
      let stopped: Promise<eventWithTime[]> | undefined;
      return {
        stop() {
          stopped ??= (async () => {
            await settleLikeStop();
            stopFn();
            return events;
          })();
          return stopped;
        },
      };
    },

    async replay(events) {
      if (events.length < 2) {
        throw new Error(`replay needs at least 2 events, got ${events.length}`);
      }
      const container = document.createElement('div');
      container.setAttribute('data-prerelease-replay', '');
      container.style.cssText =
        'position:absolute;left:-30000px;top:0;pointer-events:none';
      document.documentElement.appendChild(container);
      // A copy: the Replayer writes into the events it is given (a link's
      // late _cssText lands in its snapshot node), and failure evidence
      // must show what rrweb recorded.
      const replayer = new rrweb.Replayer(structuredClone(events), {
        root: container,
        mouseTail: false,
        triggerFocus: false,
        showWarning: false,
      });
      const first = events[0].timestamp;
      const last = events[events.length - 1].timestamp;
      // Events strictly before the offset are applied synchronously.
      replayer.pause(last - first + 1);
      await nextFrame();
      const doc = replayer.iframe.contentDocument;
      if (!doc) throw new Error('replay iframe has no document');
      return doc;
    },

    async compareComputed(events, probes) {
      // Read the live page before the replay container joins the document.
      const live: string[][] = [];
      for (const probe of probes) {
        const el = lookup(document, probe);
        if (!el) {
          return {
            ok: false,
            message: `probe not found live: ${probeName(probe)}`,
            events,
          };
        }
        live.push(computed(el, probe.props));
      }
      const unapplied = probes.find(
        (probe, i) =>
          probe.liveMustBe && probe.liveMustBe.join() !== live[i].join(),
      );
      if (unapplied) {
        return {
          ok: true,
          skipped: `engine does not apply the CSS for ${probeName(unapplied)}`,
          events,
        };
      }
      const doc = await ctx.replay(events);
      const problems: string[] = [];
      probes.forEach((probe, i) => {
        const el = lookup(doc, probe);
        if (!el) {
          problems.push(`probe not found in replay: ${probeName(probe)}`);
          return;
        }
        const replayed = computed(el, probe.props);
        probe.props.forEach((prop, j) => {
          if (replayed[j] !== live[i][j]) {
            problems.push(
              `${probeName(probe)} ${prop}: live ${JSON.stringify(
                live[i][j],
              )}, replay ${JSON.stringify(replayed[j])}`,
            );
          }
        });
      });
      return problems.length
        ? { ok: false, message: problems.join('; '), events }
        : { ok: true, events };
    },

    async measure(fn) {
      const channel = new MessageChannel();
      let running = true;
      let last = 0;
      let maxBlockMs = 0;
      let firstTick: () => void = () => undefined;
      const ticked = new Promise<void>((resolve) => (firstTick = resolve));
      channel.port1.onmessage = () => {
        const now = performance.now();
        if (last) maxBlockMs = Math.max(maxBlockMs, now - last);
        last = now;
        firstTick();
        if (running) channel.port2.postMessage(0);
      };
      channel.port2.postMessage(0);
      try {
        await ticked;
        const start = performance.now();
        const value = await fn();
        const durationMs = performance.now() - start;
        await nextFrame();
        await nextFrame();
        await sleep(100);
        return { value, durationMs, maxBlockMs };
      } finally {
        running = false;
        channel.port1.close();
      }
    },

    heapBytes() {
      return (performance as { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize;
    },

    canary(name, format = 'text') {
      // Each one a different length, so a masked run of `*` can only be that
      // value's: another canary's masked form cannot stand in for it.
      for (let extra = 0; ; extra++) {
        const digits = randomDigits(6 + extra);
        const value =
          format === 'digits'
            ? randomDigits(16 + extra)
            : format === 'email'
            ? `rrcanary${digits}@example.com`
            : `RRCANARY${name.toUpperCase()}${digits}`;
        if (!canaryLengths.has(value.length)) {
          canaryLengths.add(value.length);
          return value;
        }
      }
    },

    control(name) {
      return `RRPUBLIC${name.toUpperCase()}${randomDigits(6)}`;
    },

    assertPrivate(events, canaries, controls, proof = {}) {
      const json = JSON.stringify(events);
      const leaked = canaries.filter((canary) => json.includes(canary));
      const report = { planted: canaries.length, leaked };
      if (leaked.length > 0) {
        return {
          ok: false,
          kind: 'privacy',
          message: `privacy leak: ${leaked[0]}`,
          canaries: report,
          events,
        };
      }
      // Nothing leaked, but the recording lost something it must hold: a
      // broken recorder, which is a functional failure, not a privacy one.
      const lost = (message: string): AttemptResult => ({
        ok: false,
        kind: 'functional',
        message,
        canaries: report,
        events,
      });
      const missing = controls.find((control) => !json.includes(control));
      if (missing) return lost(`public control missing: ${missing}`);
      // Dropping the content would also leak nothing, so its masked form must
      // be there. A run of `*` exactly as long as the value.
      const runs = new Set((json.match(/\*+/g) ?? []).map((r) => r.length));
      const dropped = proof.maskedAs?.find((value) => !runs.has(value.length));
      if (dropped !== undefined) {
        return lost(
          `masked content not recorded: no run of ${dropped.length} * characters`,
        );
      }
      for (const [name, held] of Object.entries(proof.evidence ?? {})) {
        if (!held) return lost(`not recorded: ${name}`);
      }
      return { ok: true, canaries: report, events };
    },
  };
  return ctx;
}
