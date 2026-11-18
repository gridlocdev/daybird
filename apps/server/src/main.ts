import path from 'node:path';
import { parseArgs } from 'node:util';
import { FolderStore } from '@daybird/node-files';
import { bindProblem, createServer, defaultStaticDir, parseHosts, parsePort } from './server.ts';

/**
 * daybird-server (PRD §15): `daybird-server --dir <folder> [--port <n>] [--host <address>] [--no-auth]`.
 * Each option can come from the environment instead, which is how the Docker image sets them:
 *   DAYBIRD_DIR      the calendar folder; without one the server serves the web client alone
 *   DAYBIRD_PORT     port (default 8796)
 *   DAYBIRD_HOST     bind address (default 127.0.0.1)
 *   DAYBIRD_NO_AUTH  1 = listen on an address other machines reach; only behind a reverse proxy with a login
 *   DAYBIRD_HOSTS    host names the server is reached by (comma-separated); localhost and IPs always work
 *   DAYBIRD_STATIC   the built web client (default ../web/dist); empty = API only
 */
const env = process.env;
const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    port: { type: 'string' },
    host: { type: 'string' },
    'no-auth': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log('Usage: daybird-server --dir <folder> [--port <n>] [--host <address>] [--no-auth]');
  process.exit(0);
}

const dir = values.dir ?? env.DAYBIRD_DIR;
const staticDir =
  env.DAYBIRD_STATIC === ''
    ? null
    : env.DAYBIRD_STATIC !== undefined
      ? path.resolve(env.DAYBIRD_STATIC)
      : defaultStaticDir(import.meta.url);
const port = parsePort(values.port ?? env.DAYBIRD_PORT);
const host = values.host ?? env.DAYBIRD_HOST ?? '127.0.0.1';
const problem = bindProblem(host, values['no-auth'] === true || env.DAYBIRD_NO_AUTH === '1');
if (problem) {
  console.error(problem);
  process.exit(1);
}

const folder = dir ? new FolderStore(dir) : null;
const server = createServer({ staticDir, folder, allowedHosts: parseHosts(env.DAYBIRD_HOSTS) });
server.listen(port, host, () => {
  console.log(`Daybird listening on http://${host}:${port}`);
  console.log(folder ? `  calendars in ${folder.root}` : '  no --dir: calendars stay in each browser');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close(() => process.exit(0)));
