import { readFileSync } from 'node:fs';
import { runCli } from './cli.ts';

/** The `daybird` executable: the real process streams and the package's version. */

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
process.exitCode = runCli(
  process.argv.slice(2),
  { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
  pkg.version,
);
