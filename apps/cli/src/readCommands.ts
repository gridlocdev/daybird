/**
 * The commands that read the folder or bring events in and out (PRD §16): `list`, `calendars`, `import` and
 * `export`.
 */
import { readFile } from 'node:fs/promises';
import {
  eventCount,
  fromLocalSeconds,
  importEvents,
  occurrencesIn,
  readCalendar,
  todayIn,
  writeCalendar,
  addDays,
  type Occurrence,
} from '@daybird/core';
import type { FolderStore } from '@daybird/node-files';
import { UserError, calendarNamed, changeFolder, defaultCalendar, loadFolder } from './folder.ts';
import { dayRange, parseDate, wallClock } from './times.ts';

/** What every command gets: the folder, the zone times are in, and where to write. */
export interface CommandEnv {
  readonly folder: FolderStore;
  readonly zone: string;
  readonly json: boolean;
  readonly appVersion: string;
  /** UTC milliseconds. */
  readonly now: number;
  out(text: string): void;
}

export type Options = Readonly<Record<string, string | boolean | undefined>>;

export const str = (o: Options, name: string): string | undefined => {
  const v = o[name];
  return typeof v === 'string' ? v : undefined;
};

/** The occurrence's name for `--occurrence`: its first start on its own clock (a date for all-day). */
export function occurrenceName(o: Occurrence): string | null {
  if (o.key === null) return null;
  const at = fromLocalSeconds(o.key);
  return o.allDay ? at.slice(0, 10) : at.slice(0, 16);
}

function occurrenceJson(o: Occurrence, calendarName: string, zone: string) {
  return {
    calendar: calendarName,
    uid: o.uid,
    occurrence: occurrenceName(o),
    title: o.title,
    allDay: o.allDay,
    start: o.allDay ? o.startDate : wallClock(o.start, zone).slice(0, 16),
    end: o.allDay && o.endDate ? addDays(o.endDate, -1) : wallClock(o.end, zone).slice(0, 16),
    location: o.location,
    notes: o.notes,
    url: o.url,
    repeating: o.repeating,
  };
}

function occurrenceLine(o: Occurrence, calendarName: string, zone: string): string {
  let when: string;
  if (o.allDay && o.startDate && o.endDate) {
    const last = addDays(o.endDate, -1);
    when = last === o.startDate ? `${o.startDate} all day` : `${o.startDate} to ${last}, all day`;
  } else {
    const start = wallClock(o.start, zone);
    const end = wallClock(o.end, zone);
    when = `${start.slice(0, 10)} ${start.slice(11, 16)}–${end.slice(0, 10) === start.slice(0, 10) ? '' : `${end.slice(0, 10)} `}${end.slice(11, 16)}`;
  }
  const title = (o.title || 'New Event') + (o.location ? ` · ${o.location}` : '');
  const id = o.repeating ? `${o.uid} --occurrence ${occurrenceName(o)}` : o.uid;
  return `${when}  ${title}  [${calendarName}]  ${id}`;
}

export async function listCommand(opts: Options, env: CommandEnv): Promise<void> {
  const today = todayIn(env.now, env.zone);
  const fromText = str(opts, 'from');
  const toText = str(opts, 'to');
  const from = fromText ? parseDate(fromText, '--from') : today;
  const to = toText ? parseDate(toText, '--to') : from;
  const range = dayRange(from, to, env.zone);
  const { workspace } = await loadFolder(env.folder);
  const name = str(opts, 'calendar');
  const calendars = name ? [calendarNamed(workspace.calendars, name)] : workspace.calendars;
  const names = new Map(workspace.calendars.map((c) => [c.id, c.name]));
  const found = occurrencesIn(calendars, range.from, range.to, env.zone);
  if (env.json) {
    const list = found.map((o) => occurrenceJson(o, names.get(o.calendarId) ?? '', env.zone));
    env.out(`${JSON.stringify(list, null, 2)}\n`);
    return;
  }
  if (found.length === 0) {
    env.out(from === to ? `No events on ${from}.\n` : `No events from ${from} to ${to}.\n`);
    return;
  }
  for (const o of found) env.out(`${occurrenceLine(o, names.get(o.calendarId) ?? '', env.zone)}\n`);
}

export async function calendarsCommand(env: CommandEnv): Promise<void> {
  const loaded = await loadFolder(env.folder);
  const calendars = loaded.workspace.calendars;
  const fallback = calendars.some((c) => !c.readOnly) ? defaultCalendar(loaded).id : null;
  if (env.json) {
    const list = calendars.map((c) => ({
      name: c.name,
      file: c.id,
      color: c.color,
      events: eventCount(c),
      readOnly: c.readOnly,
      default: c.id === fallback,
    }));
    env.out(`${JSON.stringify(list, null, 2)}\n`);
    return;
  }
  if (calendars.length === 0) {
    env.out('The folder has no calendars.\n');
    return;
  }
  for (const c of calendars) {
    const notes = [
      c.id,
      `${eventCount(c)} ${eventCount(c) === 1 ? 'event' : 'events'}`,
      ...(c.readOnly ? [`read-only: ${c.error?.message ?? 'can’t be read'}`] : []),
      ...(c.id === fallback ? ['default'] : []),
    ];
    env.out(`${c.name}  ${c.color}  (${notes.join(', ')})\n`);
  }
}

export async function importCommand(file: string, opts: Options, env: CommandEnv): Promise<void> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    throw new UserError(`Can’t read “${file}”: ${(e as Error).message}`);
  }
  const read = readCalendar(text);
  if (!read.ok) throw new UserError(`“${file}” isn’t a calendar Daybird can read: ${read.error.message}`);
  const name = str(opts, 'calendar');
  const result = await changeFolder(env.folder, env.appVersion, (loaded) => {
    const calendar = name ? calendarNamed(loaded.workspace.calendars, name) : defaultCalendar(loaded);
    if (calendar.readOnly) throw new UserError(`${calendar.name} can’t be read, so nothing is added to it.`);
    const ctx = {
      now: Math.floor(env.now / 1000),
      makeUid: () => crypto.randomUUID(),
      displayZone: env.zone,
    };
    const r = importEvents(loaded.workspace, ctx, calendar.id, read.calendar);
    return {
      workspace: r.workspace,
      result: { calendar: calendar.name, added: r.added, skipped: r.skipped },
    };
  });
  if (env.json) env.out(`${JSON.stringify(result)}\n`);
  else
    env.out(
      `Added ${result.added} ${result.added === 1 ? 'event' : 'events'} to ${result.calendar}` +
        (result.skipped
          ? `; ${result.skipped} ${result.skipped === 1 ? 'was' : 'were'} already there.\n`
          : '.\n'),
    );
}

export async function exportCommand(name: string, env: CommandEnv): Promise<void> {
  const { workspace } = await loadFolder(env.folder);
  const calendar = calendarNamed(workspace.calendars, name);
  if (calendar.readOnly) throw new UserError(`${calendar.name} can’t be read.`);
  env.out(writeCalendar(calendar.document));
}
