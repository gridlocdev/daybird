import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderStore } from '@daybird/node-files';
import { EXIT_CONFLICT, EXIT_ERROR, EXIT_OK, changeFolder, parseLength, runCli } from '../src/index.ts';

/** Tuesday 17 November 2026, 14:00 UTC. */
const NOW = Date.UTC(2026, 10, 17, 14);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'daybird-cli-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ics = (name: string, events: string[]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    `X-WR-CALNAME:${name}`,
    ...events.flatMap((e, i) => ['BEGIN:VEVENT', `UID:${name.toLowerCase()}-${i + 1}`, e, 'END:VEVENT']),
    'END:VCALENDAR',
    '',
  ].join('\r\n');

const put = (file: string, text: string) => writeFileSync(path.join(dir, file), text);
const file = (name: string) => readFileSync(path.join(dir, name), 'utf8');

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const onFolder = argv.length > 0 && !argv[0]!.startsWith('-');
  const code = await runCli(
    [
      ...argv,
      ...(onFolder ? ['--dir', dir] : []),
      ...(onFolder && !argv.includes('--zone') ? ['--zone', 'UTC'] : []),
    ],
    { stdout: (t) => (out += t), stderr: (t) => (err += t) },
    { version: '9.8.7', now: NOW, env: {}, desktopFolder: () => Promise.resolve(null) },
  );
  return { code, out, err };
}

async function json<T>(...argv: string[]): Promise<T> {
  const r = await run(...argv, '--json');
  expect(r.err).toBe('');
  return JSON.parse(r.out) as T;
}

interface Listed {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendar: string;
  occurrence: string | null;
}

describe('daybird', () => {
  it('prints help with no arguments and with --help', async () => {
    for (const args of [[], ['--help'], ['-h']]) {
      const r = await run(...args);
      expect(r.code).toBe(EXIT_OK);
      expect(r.out).toContain('Usage: daybird');
      expect(r.err).toBe('');
    }
    expect((await run('add', '--help')).out).toContain('Usage: daybird add "<title>" --start');
  });

  it('prints the version', async () => {
    expect(await run('--version')).toEqual({ code: EXIT_OK, out: '9.8.7\n', err: '' });
    expect((await run('-V')).out).toBe('9.8.7\n');
  });

  it('refuses what it does not know', async () => {
    const r = await run('frobnicate');
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.err).toContain("unknown command 'frobnicate'");
    expect(r.out).toContain('Usage: daybird');
    expect((await run('--nope')).err).toContain("unknown option '--nope'");
    const bad = await run('list', '--nope');
    expect(bad.code).toBe(EXIT_ERROR);
    expect(bad.err).toMatch(/^daybird list: Unknown option '--nope'/);
    expect(bad.err.split('\n')).toHaveLength(2);
    expect((await run('add')).err).toContain('add needs <title>.');
  });

  it('needs a folder', async () => {
    let err = '';
    const code = await runCli(
      ['calendars'],
      { stdout: () => {}, stderr: (t) => (err += t) },
      { version: '1', env: {}, desktopFolder: () => Promise.resolve(null) },
    );
    expect(code).toBe(EXIT_ERROR);
    expect(err).toContain('pass --dir');
  });
});

describe('daybird list and calendars', () => {
  beforeEach(() => {
    put(
      'Work.ics',
      ics('Work', [
        'DTSTART:20261117T090000Z\r\nDTEND:20261117T100000Z\r\nSUMMARY:Standup\r\nLOCATION:Room 4',
        'DTSTART:20261118T120000Z\r\nDTEND:20261118T130000Z\r\nSUMMARY:Lunch',
        'DTSTART;VALUE=DATE:20261117\r\nDTEND;VALUE=DATE:20261119\r\nSUMMARY:Offsite',
      ]),
    );
    put(
      'Home.ics',
      ics('Home', [
        'DTSTART:20261116T180000Z\r\nDTEND:20261116T190000Z\r\nRRULE:FREQ=DAILY;COUNT=5\r\nSUMMARY:Run',
      ]),
    );
  });

  it('lists today by default, in text', async () => {
    const r = await run('list');
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toBe(
      [
        '2026-11-17 to 2026-11-18, all day  Offsite  [Work]  work-3',
        '2026-11-17 09:00–10:00  Standup · Room 4  [Work]  work-1',
        '2026-11-17 18:00–19:00  Run  [Home]  home-1 --occurrence 2026-11-17T18:00',
        '',
      ].join('\n'),
    );
  });

  it('lists a range of one calendar as JSON, in the zone asked for', async () => {
    const list = await json<Listed[]>(
      'list',
      '--from',
      '2026-11-18',
      '--to',
      '2026-11-19',
      '--calendar',
      'home',
    );
    expect(list.map((o) => [o.title, o.start, o.occurrence])).toEqual([
      ['Run', '2026-11-18T18:00', '2026-11-18T18:00'],
      ['Run', '2026-11-19T18:00', '2026-11-19T18:00'],
    ]);
    const tokyo = await json<Listed[]>('list', '--calendar', 'Work', '--zone', 'Asia/Tokyo');
    expect(tokyo.find((o) => o.title === 'Standup')?.start).toBe('2026-11-17T18:00');
  });

  it('says when there is nothing, and refuses a calendar that isn’t there', async () => {
    expect((await run('list', '--from', '2027-01-01')).out).toBe('No events on 2027-01-01.\n');
    const r = await run('list', '--calendar', 'Gym');
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.err).toContain('No calendar “Gym”. The calendars are: Home, Work.');
  });

  it('lists the calendars, not hidden files', async () => {
    put('.hidden.ics', 'x');
    const r = await run('calendars');
    expect(r.out).toMatch(
      /^Home {2}#[0-9A-F]{6} {2}\(Home\.ics, 1 event, default\)\nWork {2}#[0-9A-F]{6} {2}\(Work\.ics, 3 events\)\n$/i,
    );
    const list = await json<{ name: string; events: number; default: boolean }[]>('calendars');
    expect(list.map((c) => [c.name, c.events, c.default])).toEqual([
      ['Home', 1, true],
      ['Work', 3, false],
    ]);
  });
});

describe('daybird add, edit and delete', () => {
  beforeEach(() => {
    put('Work.ics', ics('Work', ['DTSTART:20261117T090000Z\r\nDTEND:20261117T100000Z\r\nSUMMARY:Standup']));
    put('Home.ics', ics('Home', []));
  });

  it('adds a timed event to the default calendar, and an all-day one to the one named', async () => {
    const made = await json<{ uid: string; calendar: string }>(
      'add',
      'Dentist',
      '--start',
      '2026-11-20T15:30',
      '--duration',
      '45m',
      '--location',
      'Main St',
    );
    expect(made.calendar).toBe('Home');
    expect(file('Home.ics')).toContain('SUMMARY:Dentist');
    expect(file('Home.ics')).toContain('LOCATION:Main St');
    expect(file('Home.ics')).toContain('DTSTART:20261120T153000Z');
    expect(file('Home.ics')).toContain('DTEND:20261120T161500Z');
    expect(file('Home.ics')).toContain('PRODID:-//Daybird//Daybird 9.8.7//EN');
    const r = await run(
      'add',
      'Holiday',
      '--start',
      '2026-12-24',
      '--end',
      '2026-12-26',
      '--calendar',
      'work',
    );
    expect(r.out).toMatch(/^Added “Holiday” to Work: [\w-]+\n$/);
    expect(file('Work.ics')).toContain('DTSTART;VALUE=DATE:20261224');
    expect(file('Work.ics')).toContain('DTEND;VALUE=DATE:20261227');
  });

  it('adds to the folder’s default calendar', async () => {
    await new FolderStore(dir).write(
      '.daybird/settings.json',
      new TextEncoder().encode('{"defaultCalendar":"Work.ics"}'),
    );
    expect((await json<{ calendar: string }>('add', 'Plan', '--start', '2026-11-20')).calendar).toBe('Work');
  });

  it('adds in the zone asked for, and a repeating event', async () => {
    await run(
      'add',
      'Call',
      '--start',
      '2026-11-20 09:00',
      '--zone',
      'America/New_York',
      '--rrule',
      'FREQ=WEEKLY;COUNT=3',
    );
    expect(file('Home.ics')).toContain('DTSTART;TZID=America/New_York:20261120T090000');
    expect(file('Home.ics')).toContain('RRULE:FREQ=WEEKLY;COUNT=3');
    const list = await json<Listed[]>(
      'list',
      '--from',
      '2026-11-20',
      '--to',
      '2026-12-31',
      '--calendar',
      'Home',
    );
    expect(list.map((o) => o.start)).toEqual(['2026-11-20T14:00', '2026-11-27T14:00', '2026-12-04T14:00']);
  });

  it('refuses times it can’t read, before touching the folder', async () => {
    const before = file('Home.ics');
    for (const [args, message] of [
      [['--start', 'tomorrow'], '--start: “tomorrow” isn’t a date'],
      [['--start', '2026-11-20T10:00', '--end', '2026-11-20T09:00'], '--end is not after --start'],
      [['--start', '2026-11-20T10:00', '--duration', 'soon'], '--duration: “soon”'],
      [['--start', '2026-11-20', '--rrule', 'FREQ=SOMETIMES'], '--rrule:'],
      [[], '--start is needed'],
    ] as const) {
      const r = await run('add', 'X', ...args);
      expect(r.code).toBe(EXIT_ERROR);
      expect(r.err).toContain(message);
    }
    expect(file('Home.ics')).toBe(before);
  });

  it('edits the title and time, keeping the length, and moves to another calendar', async () => {
    let r = await run('edit', 'work-1', '--title', 'Daily standup', '--start', '2026-11-17T11:00');
    expect(r.code).toBe(EXIT_OK);
    expect(file('Work.ics')).toContain('SUMMARY:Daily standup');
    expect(file('Work.ics')).toContain('DTEND:20261117T120000Z');
    r = await run('edit', 'work-1', '--calendar', 'Home');
    expect(r.out).toBe('Changed work-1 in Home.\n');
    expect(file('Work.ics')).not.toContain('Daily standup');
    expect(file('Home.ics')).toContain('SUMMARY:Daily standup');
    expect((await run('edit', 'work-1')).err).toContain('Nothing to change');
    expect((await run('edit', 'nope', '--title', 'x')).err).toContain('No event nope.');
  });

  it('edits and deletes one occurrence of a repeating event, and the whole of it', async () => {
    put(
      'Home.ics',
      ics('Home', [
        'DTSTART:20261116T180000Z\r\nDTEND:20261116T190000Z\r\nRRULE:FREQ=DAILY;COUNT=5\r\nSUMMARY:Run',
      ]),
    );
    expect(
      await run(
        'edit',
        'home-1',
        '--occurrence',
        '2026-11-18T18:00',
        '--title',
        'Long run',
        '--duration',
        '2h',
      ),
    ).toEqual({ code: EXIT_OK, out: 'Changed home-1 in Home.\n', err: '' });
    expect((await run('delete', 'home-1', '--occurrence', '2026-11-19T18:00')).err).toBe('');
    const list = await json<Listed[]>(
      'list',
      '--from',
      '2026-11-16',
      '--to',
      '2026-11-30',
      '--calendar',
      'Home',
    );
    expect(list.map((o) => `${o.start} ${o.end} ${o.title}`)).toEqual([
      '2026-11-16T18:00 2026-11-16T19:00 Run',
      '2026-11-17T18:00 2026-11-17T19:00 Run',
      '2026-11-18T18:00 2026-11-18T20:00 Long run',
      '2026-11-20T18:00 2026-11-20T19:00 Run',
    ]);
    expect(file('.daybird/trash.ics')).toContain('SUMMARY:Run');
    const wrong = await run('delete', 'home-1', '--occurrence', '2026-11-18T09:00');
    expect(wrong.err).toContain('home-1 has no occurrence at 2026-11-18T09:00.');
    expect((await run('delete', 'home-1')).out).toBe('Moved “Run” from Home to the Trash.\n');
    expect(
      await json<Listed[]>('list', '--from', '2026-11-16', '--to', '2026-11-30', '--calendar', 'Home'),
    ).toEqual([]);
    expect((await run('delete', 'work-1', '--occurrence', '2026-11-17T09:00')).err).toContain(
      'doesn’t repeat',
    );
  });

  it('stops a repeat with --rrule none', async () => {
    put(
      'Home.ics',
      ics('Home', ['DTSTART:20261116T180000Z\r\nDTEND:20261116T190000Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Run']),
    );
    expect((await run('edit', 'home-1', '--rrule', 'none')).err).toBe('');
    expect(file('Home.ics')).not.toContain('RRULE');
  });
});

describe('daybird import and export', () => {
  it('imports an .ics file into a calendar, skipping what is there, and exports one', async () => {
    put('Work.ics', ics('Work', ['DTSTART:20261117T090000Z\r\nDTEND:20261117T100000Z\r\nSUMMARY:Standup']));
    const source = `${dir}-in.ics`;
    writeFileSync(
      source,
      ics('Other', [
        'DTSTART:20261121T100000Z\r\nDTEND:20261121T110000Z\r\nSUMMARY:Brunch',
        'DTSTART:20261122T100000Z\r\nDTEND:20261122T110000Z\r\nSUMMARY:Walk',
      ]),
    );
    try {
      expect((await run('import', source, '--calendar', 'Work')).out).toBe('Added 2 events to Work.\n');
      expect(await json('import', source)).toEqual({ calendar: 'Work', added: 0, skipped: 2 });
    } finally {
      rmSync(source);
    }
    const r = await run('export', 'Work');
    expect(r.out).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(r.out).toContain('SUMMARY:Brunch');
    expect((await run('import', path.join(dir, 'missing.ics'))).err).toContain('Can’t read');
  });
});

describe('saving against what was read', () => {
  it('makes the change again on a fresh read after a conflict', async () => {
    put('Work.ics', ics('Work', []));
    let tries = 0;
    await changeFolder(new FolderStore(dir), '1', (loaded) => {
      tries++;
      // Another program saves the calendar between this read and this save, the first time only.
      if (tries === 1) put('Work.ics', ics('Work', ['DTSTART:20261117T090000Z\r\nSUMMARY:Elsewhere']));
      const c = loaded.workspace.calendars[0]!;
      return {
        workspace: { ...loaded.workspace, calendars: [{ ...c, document: { ...c.document } }] },
        result: null,
      };
    });
    expect(tries).toBe(2);
    expect(file('Work.ics')).toContain('Elsewhere');
  });

  it('gives up with exit 2 when the file changes again', async () => {
    put('Home.ics', ics('Home', []));
    let n = 0;
    const original = FolderStore.prototype.write;
    // Another program saves just before every save of this run.
    FolderStore.prototype.write = function (this: FolderStore, rel, bytes, opts) {
      writeFileSync(path.join(dir, rel), ics('Home', [`DTSTART:20261117T090000Z\r\nSUMMARY:Change ${n++}`]));
      return original.call(this, rel, bytes, opts);
    };
    let err = '';
    let code: number;
    try {
      code = await runCli(
        ['add', 'X', '--start', '2026-11-20T10:00', '--dir', dir],
        { stdout: () => {}, stderr: (t) => (err += t) },
        { version: '1', env: {} },
      );
    } finally {
      FolderStore.prototype.write = original;
    }
    expect(code).toBe(EXIT_CONFLICT);
    expect(err).toContain('changed while saving, twice');
    expect(file('Home.ics')).not.toContain('SUMMARY:X');
  });
});

describe('lengths', () => {
  it('reads short and ISO lengths', () => {
    expect(parseLength('45m')).toBe(2700);
    expect(parseLength('1h30m')).toBe(5400);
    expect(parseLength('2d')).toBe(172_800);
    expect(parseLength('PT1H')).toBe(3600);
    expect(() => parseLength('0m')).toThrow();
    expect(() => parseLength('-PT1H')).toThrow();
  });
});
