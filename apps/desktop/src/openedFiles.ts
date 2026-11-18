/**
 * `.ics` files opened from the Finder, the Explorer or the command line (PRD §14): the main process keeps them
 * until the page has a calendar folder open and asks for them, then the page offers to import each (§11). No
 * Electron imports, so the tests run it in Node.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** A calendar file is read whole into the page; anything larger isn't one. */
export const MAX_OPENED_BYTES = 20 * 1024 * 1024;

/** A file the page offers to import, or why it couldn't be read. */
export type OpenedFile =
  | { readonly ok: true; readonly name: string; readonly text: string }
  | { readonly ok: false; readonly name: string; readonly message: string };

export const isIcsPath = (p: string) => /\.ics$/i.test(p);

/** The `.ics` files among a launch's arguments (Windows and Linux pass opened files this way). */
export function icsArguments(argv: readonly string[], cwd: string): string[] {
  return argv.filter((a) => !a.startsWith('-') && isIcsPath(a)).map((a) => path.resolve(cwd, a));
}

export async function readOpened(file: string): Promise<OpenedFile> {
  const name = path.basename(file);
  try {
    const s = await stat(file);
    if (!s.isFile()) return { ok: false, name, message: 'it isn’t a file' };
    if (s.size > MAX_OPENED_BYTES) return { ok: false, name, message: 'it’s too large for a calendar' };
    return { ok: true, name, text: await readFile(file, 'utf8') };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ok: false, name, message: code === 'ENOENT' ? 'it’s gone' : (e as Error).message };
  }
}

/** Opened files waiting for the page. */
export class OpenedFiles {
  private paths: string[] = [];

  add(files: readonly string[]): boolean {
    const before = this.paths.length;
    for (const f of files) if (isIcsPath(f) && !this.paths.includes(f)) this.paths.push(f);
    return this.paths.length > before;
  }

  /** Reads and forgets every waiting file. */
  async take(): Promise<OpenedFile[]> {
    const paths = this.paths;
    this.paths = [];
    return Promise.all(paths.map(readOpened));
  }
}
