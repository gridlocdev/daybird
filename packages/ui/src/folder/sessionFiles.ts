/** Reading and writing one file of the folder session: pure helpers over the workspace and the store (PRD §3). */
import {
  calendarById,
  calendarFileName,
  countEventChanges,
  emptyCalendarDocument,
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
import type { RecoveryCopies } from './recoveryCopies.ts';
import type { SnapshotFile } from './snapshots.ts';
import {
  TRASH_PATH,
  isCalendarFile,
  type Conflict,
  type DiskFile,
  type FileRecord,
  type RecoveryOffer,
} from './sessionTypes.ts';

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

/** A new, empty calendar named `name` in a file of its own, with the next unused colour (§3.1, §5.2). */
export function newCalendar(ws: Workspace, name: string): Calendar {
  const id = calendarFileName(
    name,
    ws.calendars.map((c) => c.id),
  );
  const color = nextCalendarColour(ws.calendars.map((c) => c.color));
  return {
    id,
    name,
    color,
    readOnly: false,
    error: null,
    document: emptyCalendarDocument(name, color),
    problems: [],
  };
}

/** Where a deleted calendar's file goes (§7.7): `.daybird/trash/<file> <stamp>.ics`. */
export function trashedCalendarPath(path: string, stampText: string): string {
  return `.daybird/trash/${baseName(path).replace(/\.ics$/i, '')} ${stampText}.ics`;
}

/**
 * The trash as read from disk; null when there is none. A trash file Daybird can't read is moved aside, never
 * written over, and a new one starts (§3.1).
 */
export async function readTrash(
  store: CalendarStore,
  stampText: string,
): Promise<{ version: string; doc: ComponentNode } | null> {
  const disk = await readDisk(store, TRASH_PATH);
  if (!disk) return null;
  const read = readCalendar(disk.text);
  if (read.ok) return { version: disk.version, doc: read.calendar };
  // A read-only folder can't move it aside, and starts no new trash either: nothing is written there.
  if (!store.readOnly) await store.move(TRASH_PATH, `.daybird/trash unreadable ${stampText}.ics`);
  return null;
}

/** The files a closed window left unsaved changes to that differ from what this window has (§3.6). */
export function recoveryOfferOf(ws: Workspace, copies: RecoveryCopies, appVersion: string): RecoveryOffer {
  const files: { path: string; name: string }[] = [];
  for (const [path, file] of copies.latestFiles()) {
    const current = docOf(ws, path);
    if (current && serializeDoc(path, current, appVersion) === file.text) continue;
    if (path !== TRASH_PATH && calendarById(ws, path)?.readOnly) continue;
    files.push({ path, name: nameOf(ws, path) });
  }
  return { files, savedAt: copies.savedAt() };
}

/** The calendar files in the folder, by name. */
export async function calendarPaths(store: CalendarStore): Promise<string[]> {
  return (await store.list(''))
    .filter((e) => e.kind === 'file' && isCalendarFile(e.name))
    .map((e) => e.path)
    .sort((a, b) => a.localeCompare(b));
}

/** The recovery snapshot: every file with unsaved changes, as the window has it (§3.6). */
export function snapshotFiles(
  files: ReadonlyMap<string, FileRecord>,
  ws: Workspace,
  appVersion: string,
): SnapshotFile[] {
  const out: SnapshotFile[] = [];
  for (const [path, rec] of files) {
    const doc = rec.unsaved ? docOf(ws, path) : null;
    if (doc) out.push({ path, base: rec.base, text: serializeDoc(path, doc, appVersion) });
  }
  return out;
}
