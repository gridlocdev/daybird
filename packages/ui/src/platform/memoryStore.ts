import {
  ConflictError,
  NotFoundError,
  baseName,
  checkWrite,
  encodeText,
  versionOf,
  type CalendarStore,
  type Entry,
  type FileData,
  type WriteOptions,
} from './calendarStore.ts';

/**
 * A calendar folder held in memory: tests, and the last resort when the browser has no storage at all. `touch`
 * changes a file as another program would; `failWrites` makes writes to a path fail, as a full disk does.
 */
export class MemoryStore implements CalendarStore {
  readonly kind = 'memory' as const;
  readonly name: string;
  readonly isPrivate = true;
  readonly failWrites = new Set<string>();
  readonly #files = new Map<string, { bytes: Uint8Array; modified: number }>();
  #clock = 1;

  constructor(name = 'Calendars', files: Record<string, string> = {}) {
    this.name = name;
    for (const [path, text] of Object.entries(files)) this.#put(path, encodeText(text));
  }

  list(dir: string): Promise<Entry[]> {
    const out: Entry[] = [];
    const dirs = new Set<string>();
    for (const [path, f] of this.#files) {
      const prefix = dir ? `${dir}/` : '';
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) out.push({ path, name: rest, kind: 'file', size: f.bytes.length, modified: f.modified });
      else dirs.add(rest.slice(0, slash));
    }
    for (const name of dirs)
      out.push({ path: dir ? `${dir}/${name}` : name, name, kind: 'dir', size: 0, modified: 0 });
    return Promise.resolve(out);
  }

  async read(path: string): Promise<FileData> {
    const f = this.#files.get(path);
    if (!f) throw new NotFoundError(path);
    const bytes = f.bytes.slice();
    return { bytes, version: await versionOf(bytes) };
  }

  async write(path: string, bytes: Uint8Array, opts: WriteOptions = {}): Promise<string> {
    // The check and the write happen with nothing in between, as a lock gives the other stores.
    let existing = this.#files.get(path);
    let current = existing ? await versionOf(existing.bytes) : null;
    while (this.#files.get(path) !== existing) {
      existing = this.#files.get(path);
      current = existing ? await versionOf(existing.bytes) : null;
    }
    checkWrite(path, current, opts);
    if (this.failWrites.has(path)) throw new Error(`Couldn’t write “${baseName(path)}”: the disk is full.`);
    this.#put(path, bytes.slice());
    return versionOf(bytes);
  }

  move(from: string, to: string): Promise<void> {
    if (from === to) return Promise.resolve();
    const f = this.#files.get(from);
    if (!f) return Promise.reject(new NotFoundError(from));
    if (this.#files.has(to))
      return Promise.reject(new ConflictError('exists', `“${baseName(to)}” already exists.`));
    this.#files.delete(from);
    this.#files.set(to, f);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    return this.#files.delete(path) ? Promise.resolve() : Promise.reject(new NotFoundError(path));
  }

  /** Changes or deletes (`null`) a file as another program would. */
  touch(path: string, text: string | null): void {
    if (text === null) this.#files.delete(path);
    else this.#put(path, encodeText(text));
  }

  /** The text of a file, or null; for tests. */
  text(path: string): string | null {
    const f = this.#files.get(path);
    return f ? new TextDecoder().decode(f.bytes) : null;
  }

  /** Every file path, sorted; for tests. */
  paths(): string[] {
    return [...this.#files.keys()].sort();
  }

  #put(path: string, bytes: Uint8Array): void {
    this.#files.set(path, { bytes, modified: this.#clock++ });
  }
}
