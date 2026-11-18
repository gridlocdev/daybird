/**
 * Deleted calendars (PRD §7.7): files moved to `.daybird/trash/<file> <YYYY-MM-DD-HHmmss>.ics`. The Trash view
 * lists them, puts them back under their old name (or the next free one), or deletes them for good; files there
 * more than 30 days are deleted when the folder opens.
 */
import { TRASH_DAYS, calendarName, readCalendar } from '@daybird/core';
import { decodeText, type CalendarStore } from '../platform/index.ts';
import { isCalendarFile } from './sessionTypes.ts';

export const CALENDAR_TRASH_DIR = '.daybird/trash';

export interface TrashedCalendar {
  /** Where the file is now. */
  readonly path: string;
  /** The file name it had, and gets back. */
  readonly fileName: string;
  /** The calendar's name inside the file. */
  readonly name: string;
  /** Milliseconds since the epoch, from the file name's stamp. */
  readonly deleted: number;
}

const STAMPED = /^(.*) (\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.ics$/i;

/** The original file name and when it was deleted, from a trashed file's name; null for other files. */
export function parseTrashedName(name: string): { fileName: string; deleted: number } | null {
  const m = STAMPED.exec(name);
  if (!m) return null;
  const n = (i: number) => Number(m[i]);
  const deleted = new Date(n(2), n(3) - 1, n(4), n(5), n(6), n(7)).getTime();
  return { fileName: `${m[1] ?? ''}.ics`, deleted };
}

/** The deleted calendars, newest first. A file that can't be read is listed under its file name. */
export async function trashedCalendars(store: CalendarStore): Promise<TrashedCalendar[]> {
  const out: TrashedCalendar[] = [];
  for (const e of await store.list(CALENDAR_TRASH_DIR)) {
    const parsed = e.kind === 'file' ? parseTrashedName(e.name) : null;
    if (!parsed) continue;
    const name = await nameIn(store, e.path, parsed.fileName);
    out.push({ path: e.path, fileName: parsed.fileName, name, deleted: parsed.deleted });
  }
  return out.sort((a, b) => b.deleted - a.deleted);
}

/** The calendar's name inside a trashed file; its file name when the file can't be read. */
async function nameIn(store: CalendarStore, path: string, fileName: string): Promise<string> {
  const fallback = fileName.replace(/\.ics$/i, '');
  try {
    const read = readCalendar(decodeText((await store.read(path)).bytes));
    return read.ok ? calendarName(read.calendar, fileName) : fallback;
  } catch {
    return fallback;
  }
}

/** Moves a deleted calendar back into the folder; returns the file name it got. */
export async function restoreTrashedCalendar(store: CalendarStore, t: TrashedCalendar): Promise<string> {
  const taken = new Set(
    (await store.list('')).filter((e) => isCalendarFile(e.name)).map((e) => e.name.toLowerCase()),
  );
  const base = t.fileName.replace(/\.ics$/i, '');
  let target = t.fileName;
  for (let n = 2; taken.has(target.toLowerCase()); n++) target = `${base} ${n}.ics`;
  await store.move(t.path, target);
  return target;
}

/** Deletes the files deleted more than 30 days before `now` (ms); returns how many went. */
export async function purgeTrashedCalendars(store: CalendarStore, now: number): Promise<number> {
  const old = (await trashedCalendars(store)).filter((t) => t.deleted < now - TRASH_DAYS * 86_400_000);
  for (const t of old) await store.remove(t.path);
  return old.length;
}
