import path from 'node:path';
import { createServer, defaultStaticDir, parsePort } from './server.ts';

/**
 * Daybird NAS server. Configuration is environment-only so it drops straight into Docker:
 *   DAYBIRD_STATIC  path to the built web client (default ../web/dist); empty = API only
 *   DAYBIRD_HOST    bind address (default 127.0.0.1 until the file API and its token arrive)
 *   DAYBIRD_PORT    port (default 8796)
 *   DAYBIRD_ROOTS   Name=/dir;Other=/dir2   calendar folders (read with the file API, not yet)
 */
const env = process.env;
const staticDir =
  env.DAYBIRD_STATIC === ''
    ? null
    : env.DAYBIRD_STATIC !== undefined
      ? path.resolve(env.DAYBIRD_STATIC)
      : defaultStaticDir(import.meta.url);
const port = parsePort(env.DAYBIRD_PORT);
const host = env.DAYBIRD_HOST ?? '127.0.0.1';

const server = createServer({ staticDir });
server.listen(port, host, () => {
  console.log(`Daybird listening on http://${host}:${port}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close(() => process.exit(0)));
