// Where the scenarios and the driver find the app: the NAS server serving the built client over fixture data.
import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DATA = `${ROOT}.e2e-data`;
/**
 * A port no other app's checks use, so two apps' checks can run at once (Cellestra uses 8791, Puffinote 8793,
 * Taskite 8797). An app that shares one stops the other's server or fails with EADDRINUSE.
 */
export const PORT = 8795;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
/** The page's clock in every scenario and in the driver, so "today" and the fixtures' events never move. */
export const NOW = new Date('2026-11-17T14:00:00Z');
/** Every fixture file's modified time, so a view that shows file dates looks the same in every screenshot. */
const FIXTURE_TIME = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);

export const SERVER_COMMAND = ['apps/server/src/main.ts'];
const CLI = `${ROOT}apps/cli/src/main.ts`;
// The server's own settings (references/server-cli.md), with the app's prefix on every one, the port too:
// a server that ignores the port starts on its default one and the scenarios wait for it until they time out.
export const SERVER_ENV: Record<string, string> = {
  DAYBIRD_PORT: String(PORT),
  DAYBIRD_HOST: '127.0.0.1',
  DAYBIRD_STATIC: `${ROOT}apps/web/dist`,
};

/** Replace .e2e-data with a fresh copy of e2e/fixtures/<fixture>. Never point this at real data. */
export function seedData(fixture: string): void {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  cpSync(fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url)), DATA, { recursive: true });
  for (const file of readdirSync(DATA, { recursive: true, encoding: 'utf8' })) {
    utimesSync(`${DATA}/${file}`, FIXTURE_TIME, FIXTURE_TIME);
  }
}

/** A text file under .e2e-data as the server has it now, to check the disk and not just the screen. */
export function readData(file: string): string {
  return readFileSync(`${DATA}/${file}`, 'utf8');
}

/** Like readData, but undefined until the app has written the file. */
export function readDataIfThere(file: string): string | undefined {
  return existsSync(`${DATA}/${file}`) ? readData(file) : undefined;
}

/** Change a file on disk while the app has it open, as another program or machine would. */
export function writeData(file: string, text: string): void {
  writeFileSync(`${DATA}/${file}`, text);
}

/**
 * Run the app's CLI on .e2e-data, in UTC as the page shows it, and return what it prints: `cli('list', '--json')`.
 * `cli('--version')` passes no folder.
 */
export function cli(...args: string[]): string {
  const folder = args[0]?.startsWith('-') ? [] : ['--dir', DATA, '--zone', 'UTC'];
  return execFileSync(process.execPath, [CLI, ...args, ...folder], { cwd: ROOT, encoding: 'utf8' }).replace(
    /\n$/,
    '',
  );
}

/**
 * Start `daybird-server --dir .e2e-data` on `port`, apart from the scenarios' own server (which has no folder),
 * and wait until it answers. Returns its address and how to stop it.
 */
export async function startFolderServer(port: number): Promise<{ url: string; stop: () => void }> {
  const server = spawn(process.execPath, [...SERVER_COMMAND, '--dir', DATA, '--port', String(port)], {
    cwd: ROOT,
    env: { ...process.env, DAYBIRD_STATIC: SERVER_ENV.DAYBIRD_STATIC },
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 10_000;
  for (;;) {
    const up = await fetch(`${url}api/info`).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return { url, stop: () => server.kill() };
    if (Date.now() > deadline) {
      server.kill();
      throw new Error(`The folder server didn’t start on port ${port}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
