import {
  NotFoundError,
  ReadOnlyError,
  baseName,
  parentOf,
  versionOf,
  type CalendarStore,
  type Entry,
  type FileData,
} from './calendarStore.ts';

/**
 * A calendar folder picked with `<input type="file" webkitdirectory>` (PRD §3.7): how Firefox and Safari open a
 * folder, as they have no `showDirectoryPicker`. The browser hands over a snapshot of every file under the folder
 * and no way to write back, so the store is read-only and the folder is picked again on each visit.
 */
export class FileListStore implements CalendarStore {
  readonly kind = 'browser' as const;
  readonly name: string;
  readonly isPrivate = false;
  readonly readOnly = true;
  /** Each file by its folder-relative path, and each folder's direct entries. */
  readonly #files = new Map<string, File>();
  readonly #dirs = new Map<string, Map<string, Entry>>();

  /** `files` as the input gives them: `webkitRelativePath` starts with the picked folder's name, which is dropped. */
  constructor(files: Iterable<File>) {
    let name = '';
    for (const file of files) {
      const [top = '', ...rest] = file.webkitRelativePath.split('/');
      name ||= top;
      if (!rest.length) continue;
      const path = rest.join('/');
      this.#files.set(path, file);
      this.#add({ path, name: baseName(path), kind: 'file', size: file.size, modified: file.lastModified });
    }
    this.name = name || 'Folder';
  }

  list(dir: string): Promise<Entry[]> {
    return Promise.resolve([...(this.#dirs.get(dir)?.values() ?? [])]);
  }

  async read(path: string): Promise<FileData> {
    const file = this.#files.get(path);
    if (!file) throw new NotFoundError(path);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { bytes, version: await versionOf(bytes) };
  }

  write(): Promise<string> {
    return Promise.reject(new ReadOnlyError(this.name));
  }

  move(): Promise<void> {
    return Promise.reject(new ReadOnlyError(this.name));
  }

  remove(): Promise<void> {
    return Promise.reject(new ReadOnlyError(this.name));
  }

  /** Lists `entry` in its folder, and each folder above it in its own parent. */
  #add(entry: Entry): void {
    const dir = parentOf(entry.path);
    let entries = this.#dirs.get(dir);
    if (!entries) {
      entries = new Map();
      this.#dirs.set(dir, entries);
    }
    entries.set(entry.name, entry);
    if (dir && !this.#dirs.get(parentOf(dir))?.has(baseName(dir)))
      this.#add({ path: dir, name: baseName(dir), kind: 'dir', size: 0, modified: 0 });
  }
}
