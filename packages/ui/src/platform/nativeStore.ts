import {
  ConflictError,
  NotFoundError,
  type CalendarStore,
  type Entry,
  type FileData,
  type WriteOptions,
} from './calendarStore.ts';

/** A call's answer from the desktop app's main process, as plain data (an error's class doesn't cross IPC). */
export type NativeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** The calendar folder's files, through the desktop bridge. Paths are folder-relative. */
export interface NativeFiles {
  list(dir: string): Promise<NativeResult<Entry[]>>;
  read(path: string): Promise<NativeResult<FileData>>;
  write(path: string, bytes: Uint8Array, opts: WriteOptions): Promise<NativeResult<string>>;
  move(from: string, to: string): Promise<NativeResult<void>>;
  remove(path: string): Promise<NativeResult<void>>;
}

function unwrap<T>(result: NativeResult<T>, path: string): T {
  if (result.ok) return result.value;
  switch (result.code) {
    case 'changed':
    case 'deleted':
    case 'exists':
      throw new ConflictError(result.code, result.message);
    case 'not-found':
      throw new NotFoundError(path);
    default:
      throw new Error(result.message);
  }
}

/** A folder on disk, opened by the desktop app (PRD §3.7). The main process holds the folder; the page names files in it. */
export class NativeStore implements CalendarStore {
  readonly kind = 'native' as const;
  readonly isPrivate = false;
  readonly name: string;
  readonly where: string;
  readonly #files: NativeFiles;

  constructor(files: NativeFiles, name: string, where: string) {
    this.#files = files;
    this.name = name;
    this.where = where;
  }

  async list(dir: string): Promise<Entry[]> {
    return unwrap(await this.#files.list(dir), dir);
  }

  async read(path: string): Promise<FileData> {
    return unwrap(await this.#files.read(path), path);
  }

  async write(path: string, bytes: Uint8Array, opts: WriteOptions = {}): Promise<string> {
    return unwrap(await this.#files.write(path, bytes, opts), path);
  }

  async move(from: string, to: string): Promise<void> {
    unwrap(await this.#files.move(from, to), from);
  }

  async remove(path: string): Promise<void> {
    unwrap(await this.#files.remove(path), path);
  }
}
