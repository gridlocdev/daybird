import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FolderStore } from '@daybird/node-files';
import { HttpError, SECURITY_HEADERS, fileApi, httpError, sendJson } from './fileApi.ts';

/**
 * The NAS server (PRD §15): the built web client, and the file API over one calendar folder. It has no accounts:
 * on anything but this machine it belongs behind a reverse proxy that asks for a login.
 */
export interface ServerOptions {
  /** The built web client, or null to serve nothing but the API. */
  readonly staticDir: string | null;
  /** The calendar folder, or null to serve the client alone (it then keeps calendars in the browser). */
  readonly folder: FolderStore | null;
  /**
   * Host names answered besides localhost and IP addresses (`DAYBIRD_HOSTS`): the names the server is reached
   * by. Any other `Host` is refused, so a web page can't reach the folder by pointing its own name here.
   */
  readonly allowedHosts?: readonly string[];
}

export const DEFAULT_PORT = 8796;

/** apps/web/dist beside this package. */
export function defaultStaticDir(moduleUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../../web/dist');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

export function createServer(opts: ServerOptions): http.Server {
  return http.createServer((req, res) => {
    handle(req, res, opts).catch((e: unknown) => {
      const err = httpError(e);
      if (!(err instanceof HttpError)) console.error(err);
      if (res.headersSent) return void res.end();
      if (err instanceof HttpError) sendJson(res, err.status, { code: err.code, message: err.message });
      else sendJson(res, 500, { code: 'failed', message: 'Server error' });
    });
  });
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ServerOptions,
): Promise<void> {
  if (!hostAllowed(req.headers.host, opts.allowedHosts ?? []))
    throw new HttpError(421, 'Unknown host: add it to DAYBIRD_HOSTS.');
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    // The page asks first, to learn whether its calendars are here or in the browser.
    if (req.method === 'GET' && url.pathname === '/api/info')
      return sendJson(res, 200, { app: 'Daybird', name: opts.folder?.name ?? null });
    if (!opts.folder) throw new HttpError(404, 'Not found');
    return fileApi(req, res, url, opts.folder);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  if (!opts.staticDir) throw new HttpError(404, 'Not found');
  await serveStatic(res, opts.staticDir, url.pathname, req.method === 'HEAD');
}

async function serveStatic(
  res: http.ServerResponse,
  root: string,
  pathname: string,
  head: boolean,
): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Bad path');
  }
  const base = path.resolve(root);
  let file = path.resolve(base, decoded.replace(/^\/+/, '') || 'index.html');
  if (file !== base && !file.startsWith(base + path.sep)) throw new HttpError(403, 'Forbidden');
  let s = await stat(file).catch(() => null);
  if (!s || s.isDirectory()) {
    // Single-page app: unknown routes get the shell.
    file = path.join(base, 'index.html');
    s = await stat(file).catch(() => null);
    if (!s) throw new HttpError(404, 'Web client not built: run `just build-web`');
  }
  // Only the build's own hashed bundles under <root>/assets/ are immutable.
  const hashed = path.relative(base, file).split(path.sep)[0] === 'assets';
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': s.size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SECURITY_HEADERS,
  });
  if (head) return void res.end();
  res.end(await readFile(file));
}

/** The port from DAYBIRD_PORT, or the default when it is unset or not a port number. */
export function parsePort(spec: string | undefined): number {
  const n = Number(spec);
  return spec && Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

/** Parses `DAYBIRD_HOSTS` (`nas.lan, daybird.example.com`) into lowercase host names. */
export function parseHosts(spec: string | undefined): string[] {
  return (spec ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether a request's `Host` is one the server answers: localhost, an IP address, or one of `allowed`. */
export function hostAllowed(hostHeader: string | undefined, allowed: readonly string[]): boolean {
  if (!hostHeader) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare) || bare.includes(':')) return true;
  return allowed.includes(bare);
}

/** Whether a bind address is reachable only from this machine. */
export function isLoopbackHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  return bare === 'localhost' || bare === '::1' || /^127\./.test(bare);
}

/**
 * Why the server must not start on `host`, or null when it may. With no accounts, anyone who reaches the server
 * can read and change the calendars, so an address other machines can reach needs `noAuth`: the owner's promise
 * that a reverse proxy in front asks for a login.
 */
export function bindProblem(host: string, noAuth: boolean): string | null {
  if (noAuth || isLoopbackHost(host)) return null;
  return (
    `Refusing to listen on ${host || 'all addresses'}: Daybird has no accounts, so anyone who reaches it could ` +
    'read and change your calendars. Put it behind a reverse proxy that asks for a login and set ' +
    'DAYBIRD_NO_AUTH=1 (or --no-auth), or listen on 127.0.0.1.'
  );
}
