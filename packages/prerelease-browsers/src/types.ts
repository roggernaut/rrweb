export type CheckKind = 'functional' | 'privacy' | 'performance';
export type Engine = 'chromium' | 'gecko' | 'webkit';
export type Tier = 'focused' | 'full';
export interface CheckMeta {
  id: string; // kebab-case, stable forever: it is the issue identity
  kind: CheckKind;
  tier: Tier;
  needsHttp?: boolean;
  startDuringLoad?: boolean;
  head?: string; // static markup placed in <head> before the scripts
  compare?: Array<'durationMs' | 'maxBlockMs' | 'heapDeltaBytes'>; // performance only, default ['durationMs']
  /**
   * Performance only: this scenario's longest-block ceiling, for one that
   * blocks long on every browser. A target's higher ceiling still wins.
   */
  ceilingMs?: number;
}
export interface PerfSample {
  durationMs: number;
  maxBlockMs: number;
  heapDeltaBytes?: number;
}
export interface AttemptResult {
  ok: boolean;
  message?: string;
  skipped?: string; // reason; a skipped attempt is neither pass nor fail
  events?: unknown[];
  sample?: PerfSample;
  /**
   * What this failure was: 'privacy' for a leak. Without it a privacy check's
   * failure broke recording, not masking, and is filed as functional.
   */
  kind?: CheckKind;
  /** Privacy checks: every canary planted, and those found in the events. */
  canaries?: { planted: number; leaked: string[] };
}
export interface RunOptions {
  disableMasking?: boolean;
  scale?: number;
}
