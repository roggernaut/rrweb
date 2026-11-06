export interface BrowserInfo {
  browserName: string;
  browserVersion: string;
  platform: string;
  device?: string;
  userAgent: string;
}

/**
 * The only surface Node code uses to talk to a browser. Every call is short:
 * long-running work stays in the page and is polled through `evaluate`.
 */
export interface PageDriver {
  readonly canReachLocalhost: boolean;
  loadHtml(html: string): Promise<void>;
  open(url: string): Promise<void>;
  /** Evaluates a JS expression; the result must be JSON-serializable. */
  evaluate<T>(expression: string): Promise<T>;
  describe(): Promise<BrowserInfo>;
  sessionUrl?(): Promise<string | undefined>;
  markSession?(passed: boolean, reason: string): Promise<void>;
  close(): Promise<void>;
}
