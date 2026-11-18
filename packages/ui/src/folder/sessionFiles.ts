/** Reading and writing one file of the folder session: pure helpers over the workspace and the store (PRD §3). */
import {
  calendarById,
  calendarFileName,
  countEventChanges,
  loadCalendar,
  nextCalendarColour,
  readCalendar,
  withCalendar,
  withCalendarColour,
  withCalendarName,
  withDaybirdStamp,
  writeCalendar,
  type Calendar,
  type ComponentNode,
  type Workspace,
} from '@daybird/core';
import { NotFoundError, baseName, decodeText, type CalendarStore } from '../platform/calendarStore.ts';
import { TRASH_PATH, type Conflict, type DiskFile } from './sessionTypes.ts';

/** The file as it is on disk now; null when it's gone. */
export async function readDisk(store: CalendarStore, path: string): Promise<DiskFile | null> {
  try {
    const data = await store.read(path);
    return { version: data.version, text: decodeText(data.bytes) };
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

/** The document the window holds for a file: a calendar's, or the trash. */
export function docOf(ws: Workspace, path: string): ComponentNode | null {
  return path === TRASH_PATH ? ws.trash : (calendarById(ws, path)?.document ?? null);
}

/** The workspace with a file's document replaced, adding the calendar if the window doesn't have it. */
export function withDoc(ws: Workspace, path: string, doc: ComponentNode, makeUid: () => string): Workspace {
  if (path === TRASH_PATH) return { ...ws, trash: doc };
  const current = calendarById(ws, path);
  if (current) return withCalendar(ws, { ...current, document: doc, readOnly: false, error: null });
  const used = ws.calendars.map((c) => c.color);
  return withCalendar(ws, loadCalendar(path, writeCalendar(doc), makeUid, used).calendar);
}

export function parseDoc(text: string): ComponentNode | null {
  const read = readCalendar(text);
  return read.ok ? read.calendar : null;
}

/** A file's text: calendars carry Daybird's PRODID (§3.3); the trash is written as it is. */
export function serializeDoc(path: string, doc: ComponentNode, appVersion: string): string {
  return writeCalendar(path === TRASH_PATH ? doc : withDaybirdStamp(doc, appVersion));
}

/** The name the user knows a file by. */
export function nameOf(ws: Workspace, path: string): string {
  if (path === TRASH_PATH) return 'Trash';
  return calendarById(ws, path)?.name ?? baseName(path).replace(/\.ics$/i, '');
}

/** The conflict dialog's facts for a file, given what is on disk now (null: gone). */
export function conflictOf(ws: Workspace, path: string, disk: DiskFile | null): Conflict {
  const mine = docOf(ws, path);
  const theirs = disk ? parseDoc(disk.text) : null;
  return {
    path,
    name: nameOf(ws, path),
    reason: disk ? 'changed' : 'deleted',
    differs: mine && theirs ? countEventChanges(theirs, mine) : 0,
  };
}

/**
 * Save Mine as a Copy (§3.5): the calendar as this window has it, named "<name> copy" in a new file
 * `<name> copy <stamp>.ics`, with the next unused colour. Null when the window has no such calendar.
 */
export function copyOf(ws: Workspace, path: string, stampText: string): Calendar | null {
  const calendar = calendarById(ws, path);
  if (!calendar) return null;
  const name = `${calendar.name} copy`;
  const id = calendarFileName(
    `${name} ${stampText}`,
    ws.calendars.map((c) => c.id),
  );
  const color = nextCalendarColour(ws.calendars.map((c) => c.color));
  const document = withCalendarColour(withCalendarName(calendar.document, name), color);
  return { ...calendar, id, name, color, document };
}
