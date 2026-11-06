import { spawn } from 'node:child_process';

const readyTimeoutMs = 30_000;
const pollIntervalMs = 100;
/**
 * How long the process must stay up after /status first answers. A second
 * driver on a fixed port fails to bind and exits, while the leftover one
 * answers /status; this catches that instead of using the leftover.
 */
const settleMs = 500;
const stopTimeoutMs = 5_000;
/** How much of the driver's output an error message keeps. */
const outputTailChars = 2_000;

export interface DriverProcess {
  url: string;
  stop(): Promise<void>;
}

/**
 * Starts a WebDriver server such as geckodriver or safaridriver and waits
 * until `http://127.0.0.1:<port>/status` reports ready. `args` must make the
 * server listen on `port` (`--port` for geckodriver, `-p` for safaridriver).
 * Gives up after 30 s, or as soon as the process exits, including within a
 * short settle time after /status answers.
 */
export async function startDriverProcess(
  cmd: string,
  args: string[],
  port: number,
): Promise<DriverProcess> {
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const keep = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-outputTailChars);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);

  // 'close' comes after the output streams end, so the message is complete.
  let failure: Error | undefined;
  const closed = new Promise<void>((resolve) => {
    child.once('error', (err) => {
      failure ??= new Error(`${cmd} failed to start: ${err.message}`);
      resolve();
    });
    child.once('close', (code, signal) => {
      failure ??= new Error(
        `${cmd} exited with ${
          signal ? `signal ${signal}` : `code ${code}`
        } before it was ready: ${output.trim()}`,
      );
      resolve();
    });
  });

  async function stop(): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), stopTimeoutMs);
    await closed;
    clearTimeout(timer);
  }

  const giveUpAt = Date.now() + readyTimeoutMs;
  for (;;) {
    if (failure) throw failure;
    if (await isReady(url)) {
      await Promise.race([closed, new Promise((r) => setTimeout(r, settleMs))]);
      if (child.exitCode !== null || child.signalCode !== null || failure) {
        await closed;
        throw new Error(
          `${cmd} exited although ${url}/status answered, so another server holds port ${port}: ${output.trim()}`,
        );
      }
      return { url, stop };
    }
    if (Date.now() >= giveUpAt) {
      await stop();
      throw new Error(
        `${cmd} was not ready at ${url}/status after ${readyTimeoutMs} ms: ${output.trim()}`,
      );
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

async function isReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/status`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { value?: { ready?: unknown } };
    return body.value?.ready === true;
  } catch {
    return false;
  }
}
