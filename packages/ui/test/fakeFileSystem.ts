/**
 * Just enough of the File System Access API, in memory, for BrowserStore. `failWrites` names files whose writes
 * fail, as a full disk does.
 */
let clock = 1;

interface FakeFs {
  readonly failWrites: Set<string>;
}

export class FakeFile {
  readonly kind = 'file';
  bytes = new Uint8Array();
  lastModified = clock++;
  readonly name: string;
  readonly #fs: FakeFs;

  constructor(name: string, fs: FakeFs) {
    this.name = name;
    this.#fs = fs;
  }

  getFile() {
    const bytes = this.bytes;
    return Promise.resolve({
      size: bytes.length,
      lastModified: this.lastModified,
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    });
  }

  createWritable() {
    let next = this.bytes;
    return Promise.resolve({
      write: (b: Uint8Array) => {
        if (this.#fs.failWrites.has(this.name)) return Promise.reject(new Error('disk full'));
        next = b.slice();
        return Promise.resolve();
      },
      close: () => {
        this.bytes = next;
        this.lastModified = clock++;
        return Promise.resolve();
      },
      abort: () => Promise.resolve(),
    });
  }
}

export class FakeDir {
  readonly kind = 'directory';
  readonly name: string;
  readonly #children = new Map<string, FakeFile | FakeDir>();
  readonly #fs: FakeFs;

  constructor(name: string, fs: FakeFs) {
    this.name = name;
    this.#fs = fs;
  }

  getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeDir> {
    const found = this.#children.get(name);
    if (found instanceof FakeDir) return Promise.resolve(found);
    if (found) return Promise.reject(new DOMException('file', 'TypeMismatchError'));
    if (!opts.create) return Promise.reject(new DOMException('missing', 'NotFoundError'));
    const d = new FakeDir(name, this.#fs);
    this.#children.set(name, d);
    return Promise.resolve(d);
  }

  getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeFile> {
    const found = this.#children.get(name);
    if (found instanceof FakeFile) return Promise.resolve(found);
    if (found) return Promise.reject(new DOMException('dir', 'TypeMismatchError'));
    if (!opts.create) return Promise.reject(new DOMException('missing', 'NotFoundError'));
    const f = new FakeFile(name, this.#fs);
    this.#children.set(name, f);
    return Promise.resolve(f);
  }

  removeEntry(name: string): Promise<void> {
    if (!this.#children.delete(name)) return Promise.reject(new DOMException('missing', 'NotFoundError'));
    return Promise.resolve();
  }

  async *entries(): AsyncGenerator<[string, FakeFile | FakeDir]> {
    for (const c of [...this.#children.values()]) yield [c.name, c];
  }
}

/** An empty fake folder, and the switch that makes its writes fail. */
export function fakeFolder(name: string) {
  const fs = { failWrites: new Set<string>() };
  return { root: new FakeDir(name, fs), fs };
}
