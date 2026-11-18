import { after } from '../schedule.ts';
import {
  ConflictError,
  NotFoundError,
  baseName,
  checkWrite,
  parentOf,
  versionOf,
  type CalendarStore,
  type Entry,
  type FileData,
  type WriteOptions,
} from './calendarStore.ts';

/**
 * The browser's private folder (the origin-private file system), where calendars live when the browser can't open
 * a folder on disk (PRD §3.7). Resolves to null when the browser has none or site storage is blocked.
 */
export async function privateFolder(timeoutMs = 5000): Promise<FileSystemDirectoryHandle | null> {
  // A browser with site storage blocked can leave this hanging rather than refuse; give up after a while.
  const timeout = new Promise<null>((resolve) => after(timeoutMs, () => resolve(null)));
  const folder = (async () => {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('calendars', { create: true });
  })().catch(() => null);
  return Promise.race([folder, timeout]);
}

/**
 * Asks the browser to keep this site's storage under storage pressure instead of evicting it, so the private
 * folder isn't cleared to make room. Resolves to whether the storage is persistent; never throws.
 */
export async function persistStorage(): Promise<boolean> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (typeof storage?.persist !== 'function') return false;
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

/** Runs `fn` holding the Web Lock `name`, so two tabs never check and write one file at once (§3.4). */
function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? locks.request(name, fn) : fn();
}

/**
 * A calendar folder in a browser folder handle: one the user picked with the File System Access API, or the
 * private folder (tests pass in-memory ones). A writable stream writes to a swap file and replaces the file on
 * close, so a save is atomic.
 */
export class BrowserStore implements CalendarStore {
  readonly kind = 'browser' as const;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly root: FileSystemDirectoryHandle;

  constructor(root: FileSystemDirectoryHandle, isPrivate = false) {
    this.root = root;
    this.isPrivate = isPrivate;
    this.name = isPrivate ? 'This browser' : root.name;
  }

  async list(dir: string): Promise<Entry[]> {
    const handle = await this.#dir(dir, false).catch(() => null);
    if (!handle) return [];
    const out: Entry[] = [];
    for await (const [name, h] of handle.entries()) {
      const path = dir ? `${dir}/${name}` : name;
      if (h.kind === 'directory') out.push({ path, name, kind: 'dir', size: 0, modified: 0 });
      else {
        const f = await (h as FileSystemFileHandle).getFile();
        out.push({ path, name, kind: 'file', size: f.size, modified: f.lastModified });
      }
    }
    return out;
  }

  async read(path: string): Promise<FileData> {
    const f = await (await this.#file(path)).getFile();
    const bytes = new Uint8Array(await f.arrayBuffer());
    return { bytes, version: await versionOf(bytes) };
  }

  write(path: string, bytes: Uint8Array, opts: WriteOptions = {}): Promise<string> {
    return withLock(`daybird:${this.name}:${path}`, async () => {
      const conditional = opts.expected !== undefined;
      // A write that expects the file doesn't make its folders: they'd come back before the check could refuse.
      const dir = await this.#dir(parentOf(path), !conditional).catch(() => null);
      const handle = dir ? await dir.getFileHandle(baseName(path)).catch(() => null) : null;
      const current = handle
        ? await versionOf(new Uint8Array(await (await handle.getFile()).arrayBuffer()))
        : null;
      checkWrite(path, current, opts);
      if (!dir) throw new NotFoundError(parentOf(path));
      const target = handle ?? (await dir.getFileHandle(baseName(path), { create: true }));
      const w = await target.createWritable();
      try {
        await w.write(bytes as Uint8Array<ArrayBuffer>);
        await w.close();
      } catch (e) {
        // The swap file is thrown away; the file itself was never touched. If even that fails, say both.
        await w.abort().catch((abortError: unknown) => {
          throw new AggregateError(
            [e, abortError],
            `Couldn’t write “${baseName(path)}” or clean up after it.`,
          );
        });
        throw e;
      }
      return versionOf(bytes);
    });
  }

  async move(from: string, to: string): Promise<void> {
    if (from === to) return;
    const data = await this.read(from);
    if (await this.#file(to).catch(() => null))
      throw new ConflictError('exists', `“${baseName(to)}” already exists.`);
    await this.write(to, data.bytes, { create: true });
    await this.remove(from);
  }

  async remove(path: string): Promise<void> {
    const parent = await this.#dir(parentOf(path), false);
    await parent.removeEntry(baseName(path)).catch(() => {
      throw new NotFoundError(path);
    });
  }

  async #dir(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    let h = this.root;
    for (const seg of path.split('/').filter(Boolean)) {
      try {
        h = await h.getDirectoryHandle(seg, { create });
      } catch {
        throw new NotFoundError(path);
      }
    }
    return h;
  }

  async #file(path: string): Promise<FileSystemFileHandle> {
    const dir = await this.#dir(parentOf(path), false);
    try {
      return await dir.getFileHandle(baseName(path));
    } catch {
      throw new NotFoundError(path);
    }
  }
}
