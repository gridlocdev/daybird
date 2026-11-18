/** Where the desktop app keeps its own files (PRD §14). No Electron imports, so the tests run it in Node. */
import path from 'node:path';

export interface DataPaths {
  /** Overrides Electron's user-data folder, or null for the default. */
  readonly userData: string | null;
  /** Overrides the Documents folder the first start offers (Documents/Daybird), or null for the real one. */
  readonly documents: string | null;
  /** A calendar folder for this run only, not remembered. */
  readonly folder: string | null;
}

/**
 * For checks, which must never touch the owner's files: DAYBIRD_USER_DATA moves the app's own files (window place,
 * settings, the folder choice), DAYBIRD_DOCUMENTS the Documents folder it offers, and DAYBIRD_FOLDER opens a
 * calendar folder for one run.
 */
export function dataPaths(env: NodeJS.ProcessEnv): DataPaths {
  const at = (v: string | undefined) => (v ? path.resolve(v) : null);
  return {
    userData: at(env.DAYBIRD_USER_DATA),
    documents: at(env.DAYBIRD_DOCUMENTS),
    folder: at(env.DAYBIRD_FOLDER),
  };
}

/** Only our own page may use the bridge or be navigated to. */
export function isAppUrl(url: string | undefined | null): boolean {
  return typeof url === 'string' && url.startsWith('app://daybird/');
}

/** The file under `root` that an app:// path names, or null when it would leave `root`. */
export function appFile(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.normalize(path.join(root, decoded === '/' ? '/index.html' : decoded));
  return file.startsWith(root + path.sep) ? file : null;
}
