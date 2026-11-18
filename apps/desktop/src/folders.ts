// The calendar folder the desktop app has open (PRD §3.7, §14), and the page's file calls on it. No Electron
// imports, so the tests run it in Node.
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { FolderStore, folderResult, writeAtomic, type FolderResult } from '@daybird/node-files';

/** The open folder as the page sees it. `missing`: the folder chosen last time isn't there now. */
export interface FolderInfo {
  readonly path: string;
  readonly name: string;
  readonly missing: boolean;
}

/** The folder the app remembers, from `folder.json` in its data folder; null when there is none. */
export async function loadFolderChoice(file: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as { path?: unknown };
    return typeof raw.path === 'string' && path.isAbsolute(raw.path) ? raw.path : null;
  } catch {
    return null;
  }
}

export function saveFolderChoice(file: string, folder: string): Promise<void> {
  return writeAtomic(file, `${JSON.stringify({ path: folder }, null, 2)}\n`);
}

const isFolder = (p: string) =>
  stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );

/**
 * Holds the open folder. `remembered` is read once at start; `choose` opens another and remembers it unless the
 * folder was given for this run only (DAYBIRD_FOLDER, for automated checks).
 */
export class Folders {
  readonly #choiceFile: string;
  readonly #fixed: string | null;
  #store: FolderStore | null = null;
  #missing: string | null = null;

  constructor(choiceFile: string, fixed: string | null) {
    this.#choiceFile = choiceFile;
    this.#fixed = fixed ? path.resolve(fixed) : null;
  }

  /** Opens the remembered folder, or the fixed one. A remembered folder that's gone is reported, not made. */
  async start(): Promise<void> {
    if (this.#fixed) {
      await mkdir(this.#fixed, { recursive: true });
      this.#store = new FolderStore(this.#fixed);
      return;
    }
    const remembered = await loadFolderChoice(this.#choiceFile);
    if (!remembered) return;
    if (await isFolder(remembered)) this.#store = new FolderStore(remembered);
    else this.#missing = remembered;
  }

  /** The open folder; with none, the one that went missing, if any. */
  current(): FolderInfo | null {
    if (this.#store) return { path: this.#store.root, name: this.#store.name, missing: false };
    if (this.#missing) return { path: this.#missing, name: path.basename(this.#missing), missing: true };
    return null;
  }

  /** Opens `folder`, making it if needed (the first-start offer of ~/Documents/Daybird), and remembers it. */
  async open(folder: string): Promise<FolderInfo> {
    const abs = path.resolve(folder);
    await mkdir(abs, { recursive: true });
    this.#store = new FolderStore(abs);
    this.#missing = null;
    if (!this.#fixed) await saveFolderChoice(this.#choiceFile, abs);
    return { path: abs, name: this.#store.name, missing: false };
  }

  /** Runs one of the page's file calls on the open folder. */
  call(op: unknown, args: unknown): Promise<FolderResult<unknown>> {
    const store = this.#store;
    if (!store) return Promise.resolve({ ok: false, code: 'failed', message: 'No calendar folder is open.' });
    const a = Array.isArray(args) ? (args as unknown[]) : [];
    const str = (v: unknown) => {
      if (typeof v !== 'string') throw new Error('A file name was expected.');
      return v;
    };
    return folderResult(async () => {
      switch (op) {
        case 'list':
          return store.list(str(a[0]));
        case 'read':
          return store.read(str(a[0]));
        case 'write': {
          if (!(a[1] instanceof Uint8Array)) throw new Error('File contents were expected.');
          const o = (a[2] ?? {}) as { expected?: unknown; create?: unknown };
          return store.write(str(a[0]), a[1], {
            ...(typeof o.expected === 'string' ? { expected: o.expected } : {}),
            ...(o.create === true ? { create: true } : {}),
          });
        }
        case 'move':
          return store.move(str(a[0]), str(a[1]));
        case 'remove':
          return store.remove(str(a[0]));
        default:
          throw new Error(`Unknown file call: ${String(op)}`);
      }
    });
  }
}
