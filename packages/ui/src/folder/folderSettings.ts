/**
 * The settings that follow the folder (PRD §3.1, §13): `.daybird/settings.json`, so a new event lands in the same
 * calendar from the desktop app, the browser, the NAS and the CLI.
 */
import type { Calendar } from '@daybird/core';
import { encodeText, type CalendarStore } from '../platform/calendarStore.ts';
import { readDisk } from './sessionFiles.ts';

export const FOLDER_SETTINGS_PATH = '.daybird/settings.json';

export interface FolderSettings {
  /** The default calendar's file name; null for none chosen. */
  readonly defaultCalendar: string | null;
}

export const DEFAULT_FOLDER_SETTINGS: FolderSettings = { defaultCalendar: null };

/** Folder settings from the file's text; a missing, broken or odd field takes its default. */
export function parseFolderSettings(text: string): FolderSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return DEFAULT_FOLDER_SETTINGS;
  }
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return { defaultCalendar: typeof o.defaultCalendar === 'string' ? o.defaultCalendar : null };
}

export async function readFolderSettings(store: CalendarStore): Promise<FolderSettings> {
  const disk = await readDisk(store, FOLDER_SETTINGS_PATH);
  return disk ? parseFolderSettings(disk.text) : DEFAULT_FOLDER_SETTINGS;
}

/** Writes the file whole. It is Daybird's own, so the last window to change it wins. */
export async function writeFolderSettings(store: CalendarStore, settings: FolderSettings): Promise<void> {
  await store.write(FOLDER_SETTINGS_PATH, encodeText(`${JSON.stringify(settings, null, 2)}\n`));
}

/**
 * The calendar new events go to: the chosen one while it's there and writable, else the first writable calendar
 * by name. Null when there's none.
 */
export function defaultCalendarOf(calendars: readonly Calendar[], chosen: string | null): Calendar | null {
  const writable = calendars.filter((c) => !c.readOnly);
  return (
    writable.find((c) => c.id === chosen) ??
    [...writable].sort((a, b) => a.name.localeCompare(b.name))[0] ??
    null
  );
}
