/**
 * A calendar folder on disk (PRD §3.4, §3.7), for the desktop app, the NAS server and the CLI. Paths are
 * folder-relative with `/` between parts, as in the app's CalendarStore; one that would leave the folder is
 * refused. Versions are the SHA-256 of the bytes. Saves are atomic and hold the file's lock file while they
 * check the version and write.
 */
import { lstat, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { TEMP_FILE, realFile, syncFolder, versionOf, writeAtomic } from './atomic.ts';
import { FolderError, type FolderErrorCode } from './errors.ts';
import { LOCK_FILE, withLockFile } from './lockFile.ts';

export interface FolderEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: 'file' | 'dir';
  readonly size: number;
  readonly modified: number;
}

export interface FolderWriteOptions {
  /** The version last read or written: another on disk is `changed`, none is `deleted`. */
  readonly expected?: string;
  /** The file must not exist yet. */
  readonly create?: boolean;
}

const isCode = (e: unknown, code: string) => (e as NodeJS.ErrnoException).code === code;

export class FolderStore {
  /** The folder, absolute. */
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  get name(): string {
    return path.basename(this.root);
  }

  /** The absolute path for a folder path. */
  resolve(rel: string): string {
    const parts = rel.split('/').filter(Boolean);
    if (path.isAbsolute(rel) || rel.includes('\\') || parts.some((p) => p === '..' || p === '.'))
      throw new FolderError('outside', `“${rel}” isn’t in the calendar folder.`);
    return path.join(this.root, ...parts);
  }

  async list(dir: string): Promise<FolderEntry[]> {
    const abs = this.resolve(dir);
    const names = await readdir(abs).catch((e: unknown) => {
      if (isCode(e, 'ENOENT') || isCode(e, 'ENOTDIR')) return [];
      throw e;
    });
    const out: FolderEntry[] = [];
    for (const name of names) {
      if (TEMP_FILE.test(name) || LOCK_FILE.test(name)) continue;
      const s = await lstat(path.join(abs, name)).catch(() => null);
      if (!s || !(s.isFile() || s.isDirectory() || s.isSymbolicLink())) continue;
      const p = dir ? `${dir}/${name}` : name;
      if (s.isDirectory()) out.push({ path: p, name, kind: 'dir', size: 0, modified: s.mtimeMs });
      else out.push({ path: p, name, kind: 'file', size: s.size, modified: s.mtimeMs });
    }
    return out;
  }

  async read(rel: string): Promise<{ bytes: Uint8Array; version: string }> {
    const bytes = await this.#bytes(rel);
    if (!bytes)
      throw new FolderError('not-found', `“${path.posix.basename(rel)}” isn’t in the folder any more.`);
    return { bytes, version: versionOf(bytes) };
  }

  /** Saves atomically. Without options it overwrites; see FolderWriteOptions. Returns the new version. */
  async write(rel: string, bytes: Uint8Array, opts: FolderWriteOptions = {}): Promise<string> {
    const file = await realFile(this.resolve(rel));
    const name = path.posix.basename(rel);
    const dir = path.dirname(file);
    // A write that expects the file doesn't make its folders: they'd come back before the check could refuse.
    if (opts.expected !== undefined) {
      if (!(await lstat(dir).catch(() => null)))
        throw new FolderError('deleted', `“${name}” was deleted since it was read.`);
    } else await mkdir(dir, { recursive: true });
    return withLockFile(file, async () => {
      const current = await this.#bytes(rel);
      const version = current ? versionOf(current) : null;
      if (opts.create && version !== null) throw new FolderError('exists', `“${name}” already exists.`);
      if (opts.expected !== undefined && version === null)
        throw new FolderError('deleted', `“${name}” was deleted since it was read.`);
      if (opts.expected !== undefined && version !== opts.expected)
        throw new FolderError('changed', `“${name}” changed since it was read.`);
      await writeAtomic(file, bytes);
      return versionOf(bytes);
    });
  }

  /** Renames a file; a taken name is `exists`. */
  async move(from: string, to: string): Promise<void> {
    if (from === to) return;
    const src = this.resolve(from);
    const dest = this.resolve(to);
    if (!(await lstat(src).catch(() => null)))
      throw new FolderError('not-found', `“${path.posix.basename(from)}” isn’t in the folder any more.`);
    await mkdir(path.dirname(dest), { recursive: true });
    await withLockFile(dest, async () => {
      if (await lstat(dest).catch(() => null))
        throw new FolderError('exists', `“${path.posix.basename(to)}” already exists.`);
      await rename(src, dest);
    });
    await syncFolder(path.dirname(dest));
    if (path.dirname(src) !== path.dirname(dest)) await syncFolder(path.dirname(src));
  }

  async remove(rel: string): Promise<void> {
    const file = this.resolve(rel);
    if (!(await lstat(file).catch(() => null)))
      throw new FolderError('not-found', `“${path.posix.basename(rel)}” isn’t in the folder any more.`);
    await rm(file);
    await syncFolder(path.dirname(file));
  }

  async #bytes(rel: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.resolve(rel)));
    } catch (e) {
      if (isCode(e, 'ENOENT') || isCode(e, 'ENOTDIR')) return null;
      throw e;
    }
  }
}

/** A call's answer as plain data, so it crosses IPC or HTTP whole: Electron keeps only an error's message. */
export type FolderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: FolderErrorCode | 'failed'; readonly message: string };

export async function folderResult<T>(fn: () => Promise<T>): Promise<FolderResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof FolderError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}
