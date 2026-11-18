/**
 * A calendar folder as the CLI reads and writes it (PRD §3, §16): every calendar at the top of the folder, the
 * trash and the folder's settings. A change is made on what was read and saved with the versions read, so a
 * file changed meanwhile by the app or another program is never written over. On such a conflict the change is
 * made again once on a fresh read; a second conflict gives up.
 */
import {
  loadCalendar,
  readCalendar,
  withDaybirdStamp,
  writeCalendar,
  emptyTrashDocument,
  type Calendar,
  type ComponentNode,
  type Workspace,
} from '@daybird/core';
import { FolderError, type FolderStore } from '@daybird/node-files';

export const TRASH_PATH = '.daybird/trash.ics';
export const SETTINGS_PATH = '.daybird/settings.json';

/** A calendar file: `.ics` at the top of the folder, not hidden. */
export const isCalendarFile = (name: string): boolean => /\.ics$/i.test(name) && !name.startsWith('.');

/** A save found a file changed, removed or added since it was read, twice. */
export class ConflictError extends Error {}

/** What the user did wrong or asked for that isn't there; exit 1 with the message. */
export class UserError extends Error {}

export interface LoadedFolder {
  readonly workspace: Workspace;
  /** The version read of each file, by path; absent for a file that wasn't there. */
  readonly versions: ReadonlyMap<string, string>;
  /** `.daybird/settings.json`'s default calendar (§13). */
  readonly defaultCalendar: string | null;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function readText(
  folder: FolderStore,
  path: string,
): Promise<{ text: string; version: string } | null> {
  try {
    const { bytes, version } = await folder.read(path);
    return { text: decoder.decode(bytes), version };
  } catch (e) {
    if (e instanceof FolderError && e.code === 'not-found') return null;
    throw e;
  }
}

function defaultOf(text: string | undefined): string | null {
  if (text === undefined) return null;
  try {
    const o = JSON.parse(text) as { defaultCalendar?: unknown };
    return typeof o.defaultCalendar === 'string' ? o.defaultCalendar : null;
  } catch {
    // A settings file nobody can read names no default; the first calendar by name stands in (§13).
    return null;
  }
}

export async function loadFolder(folder: FolderStore): Promise<LoadedFolder> {
  const versions = new Map<string, string>();
  const paths = (await folder.list(''))
    .filter((e) => e.kind === 'file' && isCalendarFile(e.name))
    .map((e) => e.path)
    .sort((a, b) => a.localeCompare(b));
  const calendars: Calendar[] = [];
  for (const path of paths) {
    const file = await readText(folder, path);
    if (!file) continue;
    versions.set(path, file.version);
    const loaded = loadCalendar(
      path,
      file.text,
      () => crypto.randomUUID(),
      calendars.map((c) => c.color),
    );
    calendars.push(loaded.calendar);
  }
  const trashFile = await readText(folder, TRASH_PATH);
  let trash = emptyTrashDocument();
  if (trashFile) {
    const read = readCalendar(trashFile.text);
    if (!read.ok)
      throw new UserError(`The trash (${TRASH_PATH}) can’t be read; open the folder in Daybird first.`);
    trash = read.calendar;
    versions.set(TRASH_PATH, trashFile.version);
  }
  const settings = await readText(folder, SETTINGS_PATH);
  return { workspace: { calendars, trash }, versions, defaultCalendar: defaultOf(settings?.text) };
}

/** Writes each document that differs from what was read, with the version read. */
export async function saveFolder(
  folder: FolderStore,
  before: LoadedFolder,
  after: Workspace,
  appVersion: string,
): Promise<void> {
  const writes: { path: string; doc: ComponentNode; stamp: boolean }[] = [];
  for (const c of after.calendars) {
    const old = before.workspace.calendars.find((b) => b.id === c.id);
    if (c.readOnly || old?.document === c.document) continue;
    writes.push({ path: c.id, doc: c.document, stamp: true });
  }
  if (after.trash !== before.workspace.trash)
    writes.push({ path: TRASH_PATH, doc: after.trash, stamp: false });
  for (const w of writes) {
    const text = writeCalendar(w.stamp ? withDaybirdStamp(w.doc, appVersion) : w.doc);
    const expected = before.versions.get(w.path);
    await folder.write(
      w.path,
      encoder.encode(text),
      expected === undefined ? { create: true } : { expected },
    );
  }
}

const isConflict = (e: unknown) =>
  e instanceof FolderError && (e.code === 'changed' || e.code === 'deleted' || e.code === 'exists');

/**
 * Reads the folder, makes `change`, and saves. `change` returns the new workspace and what it made; it runs
 * again on a fresh read after a conflict, once.
 */
export async function changeFolder<T>(
  folder: FolderStore,
  appVersion: string,
  change: (loaded: LoadedFolder) => { workspace: Workspace; result: T },
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const loaded = await loadFolder(folder);
    const { workspace, result } = change(loaded);
    try {
      await saveFolder(folder, loaded, workspace, appVersion);
      return result;
    } catch (e) {
      if (!isConflict(e)) throw e;
      if (attempt > 0)
        throw new ConflictError(
          `The calendars changed while saving, twice; nothing more was saved. ${(e as Error).message}`,
        );
    }
  }
}

/** The calendar `name` names: its name or file name, any case. */
export function calendarNamed(calendars: readonly Calendar[], name: string): Calendar {
  const want = name.toLowerCase();
  const found =
    calendars.find((c) => c.name.toLowerCase() === want) ??
    calendars.find((c) => c.id.toLowerCase() === want || c.id.toLowerCase() === `${want}.ics`);
  if (!found)
    throw new UserError(
      `No calendar “${name}”. The calendars are: ${calendars.map((c) => c.name).join(', ') || 'none'}.`,
    );
  return found;
}

/** Where a new event goes without --calendar: the folder's default when it's writable, else the first (§13). */
export function defaultCalendar(loaded: LoadedFolder): Calendar {
  const writable = loaded.workspace.calendars.filter((c) => !c.readOnly);
  const chosen = writable.find((c) => c.id === loaded.defaultCalendar);
  const first = chosen ?? [...writable].sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!first) throw new UserError('The folder has no calendar to add to. Make one with Daybird first.');
  return first;
}
