/**
 * The `daybird` command (PRD §16). Only `--help` and `--version` so far; the commands that read and change
 * calendar folders come with the CLI slice.
 */

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;

/** Where the CLI writes. Production passes the process streams; tests capture them. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export function helpText(version: string): string {
  return [
    `daybird ${version}: calendars in plain .ics files`,
    '',
    'Usage: daybird [options]',
    '',
    'Options:',
    '  -h, --help     Show this help',
    '  -V, --version  Show the version',
    '',
  ].join('\n');
}

/** Run one invocation and return its exit code. */
export function runCli(argv: readonly string[], io: CliIo, version: string): number {
  const [first, ...rest] = argv;
  if (first === undefined || ((first === '--help' || first === '-h') && rest.length === 0)) {
    io.stdout(helpText(version));
    return EXIT_OK;
  }
  if ((first === '--version' || first === '-V') && rest.length === 0) {
    io.stdout(`${version}\n`);
    return EXIT_OK;
  }
  io.stderr(`daybird: unknown ${first.startsWith('-') ? 'option' : 'command'} '${first}'\n\n`);
  io.stdout(helpText(version));
  return EXIT_USAGE;
}
