/**
 * The calendar folder of the NAS server that serves the page (PRD §15), through its file API (`/api`). Versions
 * travel as ETags: a save sends If-Match, or If-None-Match: * to create, and the server answers 412 when the
 * file changed, went or exists.
 */
import {
  ConflictError,
  NotFoundError,
  type CalendarStore,
  type ConflictReason,
  type Entry,
  type FileData,
  type WriteOptions,
} from './calendarStore.ts';

/** A server that stopped answering fails the call, so a save is retried instead of waiting forever. */
const REQUEST_TIMEOUT_MS = 20_000;
/** The look at start only decides whether the page is on a NAS server, so it gives up sooner. */
const INFO_TIMEOUT_MS = 5_000;

const CONFLICTS: readonly string[] = ['changed', 'deleted', 'exists'] satisfies ConflictReason[];

export interface NasInfo {
  readonly app: 'Daybird';
  /** The folder's name. */
  readonly name: string;
}

/**
 * The server's calendar folder, from `/api/info`; null when the page isn't served by a Daybird server, or by one
 * started without a folder.
 */
export async function nasInfo(base = './api', fetchImpl: typeof fetch = fetch): Promise<NasInfo | null> {
  try {
    const res = await fetchImpl(`${base}/info`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(INFO_TIMEOUT_MS),
    });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const info = (await res.json()) as { app?: unknown; name?: unknown };
    return info.app === 'Daybird' && typeof info.name === 'string'
      ? { app: 'Daybird', name: info.name }
      : null;
  } catch (e) {
    console.info('No Daybird server answered; calendars stay in this browser.', e);
    return null;
  }
}

export class NasStore implements CalendarStore {
  readonly kind = 'nas' as const;
  readonly isPrivate = false;
  readonly name: string;
  /** Shown on hover in the status bar. */
  readonly where: string;
  readonly #base: string;
  readonly #fetch: typeof fetch;

  constructor(name: string, base = './api', fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.name = name;
    this.#base = base.replace(/\/$/, '');
    this.#fetch = fetchImpl;
    this.where = `${name} on the server`;
  }

  async list(dir: string): Promise<Entry[]> {
    const res = await this.#request(`/list?${new URLSearchParams({ path: dir })}`, {}, dir);
    return (await res.json()) as Entry[];
  }

  async read(path: string): Promise<FileData> {
    const res = await this.#request(this.#file(path), {}, path);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const etag = res.headers.get('etag');
    if (!etag) throw new Error(`The server sent “${path}” without its version.`);
    return { bytes, version: etag.replace(/^W\//, '').replace(/^"|"$/g, '') };
  }

  async write(path: string, bytes: Uint8Array, opts: WriteOptions = {}): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    if (opts.expected !== undefined) headers['If-Match'] = `"${opts.expected}"`;
    if (opts.create) headers['If-None-Match'] = '*';
    const res = await this.#request(
      this.#file(path),
      { method: 'PUT', headers, body: bytes as Uint8Array<ArrayBuffer> },
      path,
    );
    return ((await res.json()) as { version: string }).version;
  }

  async move(from: string, to: string): Promise<void> {
    await this.#request(
      '/move',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }) },
      from,
    );
  }

  async remove(path: string): Promise<void> {
    await this.#request(this.#file(path), { method: 'DELETE' }, path);
  }

  #file(path: string): string {
    return `/file?${new URLSearchParams({ path })}`;
  }

  async #request(route: string, init: RequestInit, path: string): Promise<Response> {
    const res = await this.#fetch(`${this.#base}${route}`, {
      ...init,
      cache: 'no-store',
      headers: { ...(init.headers as Record<string, string> | undefined), 'X-Daybird-Request': '1' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return res;
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    const message = body.message ?? `The server answered ${res.status}.`;
    if (body.code && CONFLICTS.includes(body.code))
      throw new ConflictError(body.code as ConflictReason, message);
    if (res.status === 404 && body.code === 'not-found') throw new NotFoundError(path);
    throw new Error(message);
  }
}
