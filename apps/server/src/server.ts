import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The NAS server (PRD §15). For now it only serves the built web client; the file API over calendar folders
 * comes with the NAS slice.
 */
export interface ServerOptions {
  /** The built web client, or null to serve nothing but the API. */
  readonly staticDir: string | null;
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

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createServer(opts: ServerOptions): http.Server {
  return http.createServer((req, res) => {
    handle(req, res, opts).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (res.headersSent) return void res.end();
      const body = JSON.stringify({ error: e instanceof HttpError ? e.message : 'Server error' });
      res.writeHead(status, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(body);
    });
  });
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ServerOptions,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
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
