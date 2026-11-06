import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checks } from '../page/registry.ts';
import type { CheckMeta } from '../types.ts';
import { composePage, escapeInlineScript } from './page-source.ts';

export interface FixtureServer {
  origin: string;
  crossOrigin: string;
  close(): Promise<void>;
}

export const defaultHttpPort = 8123;
const slowCssDelayMs = 500;

/** The page a cross-origin iframe check embeds: rrweb plus one control string (base64 in the query). */
function framePage(rrweb: string): string {
  const script = `
    rrweb.record({ recordCrossOriginIframes: true, emit() {} });
    const p = document.createElement('p');
    p.id = 'child';
    p.textContent = atob(new URLSearchParams(location.search).get('c') || '');
    document.body.appendChild(p);
  `;
  return [
    '<!doctype html>',
    '<meta charset="utf-8">',
    `<script>${escapeInlineScript(rrweb)}</script>`,
    `<body><script>${script}</script></body>`,
  ].join('\n');
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/**
 * Serves the pages that need a real origin on two ports at 127.0.0.1, so one
 * is cross-origin to the other. Ports come from PRERELEASE_HTTP_PORT and the
 * next one up (default 8123), which lets `adb reverse` map them; 0 picks free
 * ports.
 */
export async function startFixtureServer(src: {
  bundle: string;
  rrweb: string;
}): Promise<FixtureServer> {
  const basePort = process.env.PRERELEASE_HTTP_PORT
    ? Number(process.env.PRERELEASE_HTTP_PORT)
    : defaultHttpPort;
  if (!Number.isInteger(basePort) || basePort < 0 || basePort > 65534) {
    throw new Error(`invalid PRERELEASE_HTTP_PORT: ${basePort}`);
  }
  const ports: number[] = [];
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  function send(
    res: ServerResponse,
    status: number,
    type: string,
    body: string,
  ): void {
    res.writeHead(status, {
      'content-type': `${type}; charset=utf-8`,
      'cache-control': 'no-store',
    });
    res.end(body);
  }

  /** Base URL of the other server, as the browser addressed this one. */
  function otherOrigin(req: IncomingMessage): string {
    const here = req.socket.localPort;
    const other = here === ports[0] ? ports[1] : ports[0];
    const hostname = new URL(`http://${req.headers.host ?? '127.0.0.1'}`)
      .hostname;
    return `http://${hostname}:${other}`;
  }

  function checkPage(meta: CheckMeta, req: IncomingMessage): string {
    const page = composePage(meta, src.bundle, src.rrweb);
    const cross = JSON.stringify(otherOrigin(req));
    // Before the bundle, so checks can read it from beforeRrweb or run.
    return page.replace(
      '<meta charset="utf-8">',
      `<meta charset="utf-8">\n<script>window.__prerelease_cross_origin=${cross}</script>`,
    );
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://fixture.invalid');
    const path = url.pathname;
    if (req.method !== 'GET') return send(res, 405, 'text/plain', 'GET only');
    if (path === '/assets/slow.css') {
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        send(res, 200, 'text/css', '#early{color:rgb(0,0,255)}');
      }, slowCssDelayMs);
      pendingTimers.add(timer);
      res.on('close', () => {
        clearTimeout(timer);
        pendingTimers.delete(timer);
      });
      return;
    }
    const check = /^\/check\/([^/]+)$/.exec(path);
    if (check) {
      const meta = checks.find((c) => c.id === decodeURIComponent(check[1]));
      if (!meta) return send(res, 404, 'text/plain', 'unknown check');
      return send(res, 200, 'text/html', checkPage(meta, req));
    }
    if (/^\/frame\/[^/]+$/.test(path)) {
      return send(res, 200, 'text/html', framePage(src.rrweb));
    }
    send(res, 404, 'text/plain', 'not found');
  }

  const servers = [createServer(handle), createServer(handle)];
  try {
    ports[0] = await listen(servers[0], basePort);
    ports[1] = await listen(servers[1], basePort === 0 ? 0 : basePort + 1);
  } catch (err) {
    await Promise.all(servers.map(closeServer));
    throw err;
  }

  return {
    origin: `http://127.0.0.1:${ports[0]}`,
    crossOrigin: `http://127.0.0.1:${ports[1]}`,
    async close() {
      for (const timer of pendingTimers) clearTimeout(timer);
      pendingTimers.clear();
      await Promise.all(servers.map(closeServer));
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.closeAllConnections();
    server.close(() => resolve());
  });
}
