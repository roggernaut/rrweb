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

/**
 * Thrown by loadHtml when the driver cannot give the page a new Window:
 * navigation kept the old one, and a fresh tab was unavailable or kept it
 * too. Every later load would fail the same way, so runTarget stops the
 * target instead of recording check failures.
 */
export class RealmReuseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RealmReuseError';
  }
}
