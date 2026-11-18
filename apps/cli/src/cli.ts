/**
 * The `daybird` command (PRD §16): reads and changes a calendar folder with the same engine as the app. Every
 * change is saved against the versions read, so the app's open windows pick it up and nothing they saved is
 * written over.
 */
import { stat } from 'node:fs/promises';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { systemZoneId } from '@daybird/core';
import { FolderStore } from '@daybird/node-files';
import { desktopFolder } from './defaultFolder.ts';
import { addCommand, deleteCommand, editCommand } from './eventCommands.ts';
import { ConflictError, UserError } from './folder.ts';
import {
  calendarsCommand,
  exportCommand,
  importCommand,
  listCommand,
  type CommandEnv,
  type Options,
} from './readCommands.ts';
import { checkZone } from './times.ts';

export const EXIT_OK = 0;
/** Something went wrong; the message is on stderr. */
export const EXIT_ERROR = 1;
/** The calendars changed while saving, again after one retry. */
export const EXIT_CONFLICT = 2;

/** Where the CLI writes. Production passes the process streams; tests capture them. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

/** What the run may read from its surroundings; tests set each. */
export interface CliContext {
  readonly version: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** UTC milliseconds. */
  readonly now?: number;
  /** The desktop app's last folder, when there is one. */
  readonly desktopFolder?: () => Promise<string | null>;
}

const text = { type: 'string' } as const;
const flag = { type: 'boolean' } as const;

const EVENT_FIELDS: ParseArgsOptionsConfig = {
  start: text,
  end: text,
  duration: text,
  'all-day': flag,
  calendar: text,
  rrule: text,
  location: text,
  notes: text,
  url: text,
};

interface CommandSpec {
  /** The positional arguments, by name. */
  readonly args: readonly string[];
  readonly options: ParseArgsOptionsConfig;
  readonly usage: string;
  readonly help: string;
}

const COMMANDS: Readonly<Record<string, CommandSpec>> = {
  list: {
    args: [],
    options: { from: text, to: text, calendar: text },
    usage: 'list [--from <date>] [--to <date>] [--calendar <name>]',
    help: 'Events from --from to --to, both included (default: today)',
  },
  add: {
    args: ['title'],
    options: EVENT_FIELDS,
    usage:
      'add "<title>" --start <date-time> [--end <date-time> | --duration <length>] [--all-day] [--calendar <name>] [--rrule <rule>] [--location <text>] [--notes <text>] [--url <url>]',
    help: 'Add an event; a date without a time makes it all-day',
  },
  edit: {
    args: ['uid'],
    options: { ...EVENT_FIELDS, title: text, occurrence: text },
    usage:
      'edit <uid> [--occurrence <date-time>] [--title <text>] [--start …] [--end … | --duration …] [--calendar <name>] [--rrule <rule> | --rrule none] [--location …] [--notes …] [--url …]',
    help: 'Change an event, or one occurrence of a repeating one; --calendar moves it',
  },
  delete: {
    args: ['uid'],
    options: { occurrence: text },
    usage: 'delete <uid> [--occurrence <date-time>]',
    help: 'Move an event, or one occurrence, to the Trash',
  },
  calendars: { args: [], options: {}, usage: 'calendars', help: 'The calendars in the folder' },
  import: {
    args: ['file'],
    options: { calendar: text },
    usage: 'import <file.ics> [--calendar <name>]',
    help: 'Add the events of an .ics file to a calendar (default: the default calendar)',
  },
  export: {
    args: ['calendar'],
    options: {},
    usage: 'export <calendar>',
    help: 'Print a calendar as .ics',
  },
};

const GLOBAL: ParseArgsOptionsConfig = {
  dir: text,
  zone: text,
  json: flag,
  help: { type: 'boolean', short: 'h' },
};

export function helpText(version: string): string {
  const width = Math.max(...Object.keys(COMMANDS).map((n) => n.length));
  return [
    `daybird ${version}: calendars in plain .ics files`,
    '',
    'Usage: daybird <command> [options]',
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(width)}  ${c.help}`),
    '',
    'Options for every command:',
    '  --dir <folder>   The calendar folder (default: $DAYBIRD_DIR, else the folder Daybird opened last)',
    '  --zone <zone>    The time zone times are typed and shown in (default: the system’s)',
    '  --json           Print JSON',
    '  -h, --help       Show help; `daybird <command> --help` shows the command’s',
    '  -V, --version    Show the version',
    '',
    'Dates are 2026-11-17; date-times are 2026-11-17T09:30 (a trailing Z means UTC). Lengths are 45m, 1h30m,',
    '2d or PT1H. Rules are RFC 5545 RRULEs such as FREQ=WEEKLY;BYDAY=MO,WE.',
    '',
    'Exit codes: 0 done, 1 error, 2 the calendars changed while saving, again after one retry.',
    '',
  ].join('\n');
}

function commandHelp(spec: CommandSpec): string {
  return `${spec.help}.\n\nUsage: daybird ${spec.usage} [--dir <folder>] [--zone <zone>] [--json]\n`;
}

async function folderFor(dir: string | undefined, ctx: CliContext): Promise<FolderStore> {
  const env = ctx.env ?? process.env;
  const chosen = dir ?? env.DAYBIRD_DIR ?? (await (ctx.desktopFolder ?? desktopFolder)());
  if (!chosen)
    throw new UserError('No calendar folder: pass --dir <folder>, or open one in the Daybird app first.');
  const isDir = await stat(chosen).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isDir) throw new UserError(`“${chosen}” isn’t a folder.`);
  return new FolderStore(chosen);
}

async function run(
  name: string,
  spec: CommandSpec,
  argv: readonly string[],
  io: CliIo,
  ctx: CliContext,
): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { ...GLOBAL, ...spec.options },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    io.stdout(commandHelp(spec));
    return;
  }
  if (positionals.length !== spec.args.length) {
    const missing = spec.args[positionals.length];
    throw new UserError(
      missing
        ? `${name} needs <${missing}>. Usage: daybird ${spec.usage}`
        : `${name} takes ${spec.args.length ? `only <${spec.args.join('> <')}>` : 'no arguments'}; “${positionals[spec.args.length]}” is extra.`,
    );
  }
  const opts = values as Options;
  const env: CommandEnv = {
    folder: await folderFor(values.dir as string | undefined, ctx),
    zone: checkZone((values.zone as string | undefined) ?? systemZoneId()),
    json: values.json === true,
    appVersion: ctx.version,
    now: ctx.now ?? Date.now(),
    out: (t) => io.stdout(t),
  };
  const [first = ''] = positionals;
  switch (name) {
    case 'list':
      return listCommand(opts, env);
    case 'calendars':
      return calendarsCommand(env);
    case 'import':
      return importCommand(first, opts, env);
    case 'export':
      return exportCommand(first, env);
    case 'add':
      return addCommand(first, opts, env);
    case 'edit':
      return editCommand(first, opts, env);
    case 'delete':
      return deleteCommand(first, opts, env);
  }
}

const isUsageError = (e: unknown) => {
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS');
};

/** Run one invocation and return its exit code. */
export async function runCli(argv: readonly string[], io: CliIo, ctx: CliContext): Promise<number> {
  const [first, ...rest] = argv;
  if (first === undefined || ((first === '--help' || first === '-h') && rest.length === 0)) {
    io.stdout(helpText(ctx.version));
    return EXIT_OK;
  }
  if ((first === '--version' || first === '-V') && rest.length === 0) {
    io.stdout(`${ctx.version}\n`);
    return EXIT_OK;
  }
  const spec = Object.hasOwn(COMMANDS, first) ? COMMANDS[first] : undefined;
  if (!spec) {
    io.stderr(`daybird: unknown ${first.startsWith('-') ? 'option' : 'command'} '${first}'\n\n`);
    io.stdout(helpText(ctx.version));
    return EXIT_ERROR;
  }
  try {
    await run(first, spec, rest, io, ctx);
    return EXIT_OK;
  } catch (e) {
    io.stderr(`daybird ${first}: ${(e as Error).message}\n`);
    if (e instanceof ConflictError) return EXIT_CONFLICT;
    // Anything but a refused request is a fault in Daybird: its stack helps the report.
    if (!(e instanceof UserError) && !isUsageError(e)) io.stderr(`${(e as Error).stack ?? ''}\n`);
    return EXIT_ERROR;
  }
}
