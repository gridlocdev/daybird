/**
 * Where the calendar folder lives (PRD §3.1, §3.7). The app only ever talks to a CalendarStore; it never knows
 * whether the folder is in memory, in the browser, on the NAS server or on disk through Electron. Paths are
 * folder-relative with `/` between parts: `Work.ics`, `.daybird/trash.ics`.
 */
export type StoreKind = 'memory' | 'browser' | 'nas' | 'native';

export interface Entry {
  readonly path: string;
  readonly name: string;
  readonly kind: 'file' | 'dir';
  /** Bytes; 0 for a folder. */
  readonly size: number;
  /** Milliseconds since the epoch; 0 when the store can't tell. */
  readonly modified: number;
}

export interface FileData {
  readonly bytes: Uint8Array;
  /** The SHA-256 of the bytes, in hex (§3.5). */
  readonly version: string;
}

export interface WriteOptions {
  /**
   * The version the caller last read or wrote. A different one on disk throws ConflictError('changed'), and a
   * file that is gone throws ConflictError('deleted'), never recreating it.
   */
  readonly expected?: string;
  /** The file must not exist yet (a new calendar); an existing one throws ConflictError('exists'). */
  readonly create?: boolean;
}

export interface CalendarStore {
  readonly kind: StoreKind;
  /** The folder's display name. */
  readonly name: string;
  /** Where the folder is, when its name alone doesn't tell folders apart: the full path on disk. */
  readonly where?: string;
  /** "Stored in this browser" (§3.7): the folder isn't one the user can see on disk. */
  readonly isPrivate: boolean;
  /**
   * The folder can be read but not written (§3.7): Firefox and Safari hand over a snapshot of its files. Every write
   * rejects with ReadOnlyError, and the app turns off what would write.
   */
  readonly readOnly?: boolean;
  /** The entries directly in `dir` (`''` for the folder itself). A missing folder lists as empty. */
  list(dir: string): Promise<Entry[]>;
  read(path: string): Promise<FileData>;
  /**
   * Writes a file atomically, making its parent folders. Without `expected` or `create` it overwrites whatever is
   * there: the user chose it (Keep Mine), or the file is the app's own (settings). Returns the new version.
   */
  write(path: string, bytes: Uint8Array, opts?: WriteOptions): Promise<string>;
  /** Renames a file. Throws ConflictError('exists') if `to` is taken. */
  move(from: string, to: string): Promise<void>;
  /** Deletes a file. */
  remove(path: string): Promise<void>;
}

export type ConflictReason = 'changed' | 'deleted' | 'exists';

/** The file changed or went since it was read, or already exists. */
export class ConflictError extends Error {
  readonly reason: ConflictReason;

  constructor(reason: ConflictReason, message: string) {
    super(message);
    this.name = 'ConflictError';
    this.reason = reason;
  }
}

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`“${path}” isn’t in the folder any more.`);
    this.name = 'NotFoundError';
  }
}

/** A write to a folder that was opened read-only. */
export class ReadOnlyError extends Error {
  constructor(folder: string) {
    super(`“${folder}” is open read-only.`);
    this.name = 'ReadOnlyError';
  }
}

/** The version of some bytes: their SHA-256 in hex. */
export async function versionOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Checks a conditional write against what is on disk now (`null`: no file). */
export function checkWrite(path: string, current: string | null, opts: WriteOptions): void {
  if (opts.create && current !== null)
    throw new ConflictError('exists', `“${baseName(path)}” already exists.`);
  if (opts.expected === undefined) return;
  if (current === null)
    throw new ConflictError('deleted', `“${baseName(path)}” was deleted since it was read.`);
  if (current !== opts.expected)
    throw new ConflictError('changed', `“${baseName(path)}” changed since it was read.`);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export const encodeText = (text: string): Uint8Array => new TextEncoder().encode(text);
export const decodeText = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
