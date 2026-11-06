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

export function createContext(runOptions: RunOptions): CheckContext {
  const rrweb = window.rrweb;
  const options: Required<RunOptions> = {
    disableMasking: runOptions.disableMasking ?? false,
    scale: runOptions.scale ?? 1,
  };

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
            await nextFrame();
            await nextFrame();
            await sleep(50);
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
      const replayer = new rrweb.Replayer(events, {
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
      if (format === 'digits') return randomDigits(16);
      if (format === 'email') return `rrcanary${randomDigits(6)}@example.com`;
      return `RRCANARY${name.toUpperCase()}${randomDigits(6)}`;
    },

    control(name) {
      return `RRPUBLIC${name.toUpperCase()}${randomDigits(6)}`;
    },

    assertPrivate(events, canaries, controls) {
      const json = JSON.stringify(events);
      const leak = canaries.find((canary) => json.includes(canary));
      if (leak) return { ok: false, message: `privacy leak: ${leak}`, events };
      const missing = controls.find((control) => !json.includes(control));
      // Nothing leaked, but the recording lost public text too: a broken
      // recorder, which is a functional failure, not a privacy one.
      if (missing) {
        return {
          ok: false,
          kind: 'functional',
          message: `public control missing: ${missing}`,
          events,
        };
      }
      return { ok: true, events };
    },
  };
  return ctx;
}
