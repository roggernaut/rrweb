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
}
export interface RunOptions {
  disableMasking?: boolean;
  scale?: number;
}
