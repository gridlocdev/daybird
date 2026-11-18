/**
 * The file API over the server's one calendar folder (PRD §15), under `/api`. The page's NasStore is its only
 * client. It answers for the calendar files at the top of the folder and for Daybird's own `.daybird` folder,
 * nothing else. Versions are the files' SHA-256 (§3.5), sent as ETags; saves hold the lock file (§3.7).
 *
 *   GET    /api/info                 {app: 'Daybird', name}: answered by the server, with or without a folder
 *   GET    /api/list?path=<dir>      the entries in a folder
 *   GET    /api/file?path=<file>     the bytes, with the version as ETag
 *   PUT    /api/file?path=<file>     If-Match: "<version>" or If-None-Match: *; answers {version}
 *   DELETE /api/file?path=<file>
 *   POST   /api/move                 {from, to}
 *
 * A refusal answers `{code, message}`: 412 for a conflict (`changed`, `deleted`, `exists`), 404 `not-found`, 403
 * `outside`, 503 `busy`.
 */
import type http from 'node:http';
import { FolderError, type FolderErrorCode, type FolderStore } from '@daybird/node-files';

/** The largest file a save may send. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Every request but a read carries it, so a form on another site can't change the folder. */
export const REQUEST_HEADER = 'x-daybird-request';

export class HttpError extends Error {
  readonly status: number;
  readonly code: FolderErrorCode | 'failed';
  constructor(status: number, message: string, code: FolderErrorCode | 'failed' = 'failed') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const STATUS: Record<FolderErrorCode, number> = {
  changed: 412,
  deleted: 412,
  exists: 412,
  'not-found': 404,
  outside: 403,
  busy: 503,
};

/** The HTTP answer for a folder refusal; anything else is left for the server's 500. */
export function httpError(e: unknown): unknown {
  return e instanceof FolderError ? new HttpError(STATUS[e.code], e.message, e.code) : e;
}

/** Whether the API answers for a path: the folder itself, a calendar at its top, or Daybird's own folder. */
export function servedPath(p: string): boolean {
  return p === '' || p === '.daybird' || p.startsWith('.daybird/') || /^[^/.][^/]*\.ics$/i.test(p);
}

function pathParam(url: URL, name = 'path'): string {
  const p = url.searchParams.get(name);
  if (p === null) throw new HttpError(400, `Missing ${name}`);
  return checked(p);
}

function checked(p: string): string {
  if (!servedPath(p)) throw new HttpError(403, `“${p}” isn’t a calendar in the folder.`, 'outside');
  return p;
}

/** The version in an If-Match header: `"abc"` or `W/"abc"` gives `abc`. */
function etagValue(header: string): string {
  return header.replace(/^W\//, '').replace(/^"|"$/g, '');
}

function header(req: http.IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  return typeof v === 'string' ? v : null;
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
  });
  res.end(text);
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > MAX_FILE_BYTES) {
    req.resume();
    return Promise.reject(new HttpError(413, 'The file is too large.'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_FILE_BYTES) {
        req.destroy();
        reject(new HttpError(413, 'The file is too large.'));
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function moveBody(req: http.IncomingMessage): Promise<{ from: string; to: string }> {
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req)).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Bad request');
  }
  const { from, to } = (body ?? {}) as Record<string, unknown>;
  if (typeof from !== 'string' || typeof to !== 'string') throw new HttpError(400, 'Bad request');
  return { from: checked(from), to: checked(to) };
}

/** Answers one `/api` request against `folder`. */
export async function fileApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  folder: FolderStore,
): Promise<void> {
  const route = `${req.method} ${url.pathname}`;
  if (req.method !== 'GET' && req.method !== 'HEAD' && header(req, REQUEST_HEADER) !== '1')
    throw new HttpError(403, 'Forbidden');
  switch (route) {
    case 'GET /api/list': {
      // A folder the API doesn't serve lists as empty, as a missing one does.
      const dir = url.searchParams.get('path') ?? '';
      const entries = servedPath(dir) ? await folder.list(dir) : [];
      return sendJson(
        res,
        200,
        entries.filter((e) => servedPath(e.path)),
      );
    }
    case 'GET /api/file': {
      const { bytes, version } = await folder.read(pathParam(url));
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': bytes.length,
        'Cache-Control': 'no-store',
        ETag: `"${version}"`,
        ...SECURITY_HEADERS,
      });
      return void res.end(bytes);
    }
    case 'PUT /api/file': {
      const p = pathParam(url);
      const ifMatch = header(req, 'if-match');
      const body = await readBody(req);
      const version = await folder.write(p, new Uint8Array(body), {
        ...(ifMatch !== null ? { expected: etagValue(ifMatch) } : {}),
        ...(header(req, 'if-none-match') === '*' ? { create: true } : {}),
      });
      res.setHeader('ETag', `"${version}"`);
      return sendJson(res, 200, { version });
    }
    case 'DELETE /api/file':
      await folder.remove(pathParam(url));
      return sendJson(res, 200, {});
    case 'POST /api/move': {
      const { from, to } = await moveBody(req);
      await folder.move(from, to);
      return sendJson(res, 200, {});
    }
    default:
      throw new HttpError(404, 'Not found');
  }
}
