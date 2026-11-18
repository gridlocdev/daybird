/**
 * The folder the CLI works on without `--dir` (PRD §16): `DAYBIRD_DIR`, else the folder the desktop app opened
 * last, from `folder.json` in its data folder.
 */
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** The desktop app's data folder on this system. */
export function desktopDataFolder(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Daybird');
  if (platform === 'win32') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Daybird');
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Daybird');
}

/** The folder in `folder.json`; null when the app never opened one. */
export async function desktopFolder(dataFolder: string = desktopDataFolder()): Promise<string | null> {
  // No file, or one that can't be read, means no folder: the caller asks for --dir.
  const text = await readFile(path.join(dataFolder, 'folder.json'), 'utf8').catch(() => null);
  if (text === null) return null;
  let raw: { path?: unknown };
  try {
    raw = JSON.parse(text) as { path?: unknown };
  } catch {
    return null;
  }
  return typeof raw.path === 'string' && path.isAbsolute(raw.path) ? raw.path : null;
}
