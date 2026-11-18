/** What the sidebar's calendar rows do (PRD §5.2, §7.7, §13): show and hide, rename, colour, default, delete. */
import { batch } from '@preact/signals';
import {
  calendarById,
  withCalendar,
  withCalendarColour,
  withCalendarName,
  type Calendar,
} from '@daybird/core';
import { readFolderSettings, writeFolderSettings } from '@daybird/ui';
import type { AppController, CalendarDialog } from './controller.ts';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Shows or hides a calendar on this device. */
export function toggleCalendar(app: AppController, id: string): void {
  const hidden = app.settings.peek().hiddenCalendars;
  app.update({
    hiddenCalendars: hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id],
  });
}

/** Opens one of a calendar's dialogs; `new` needs no calendar. */
export function openCalendarDialog(app: AppController, kind: CalendarDialog, id: string | null): void {
  batch(() => {
    app.calendarMenu.value = null;
    app.calendarTarget.value = id;
    app.calendarDialog.value = kind;
  });
}

export function closeCalendarDialog(app: AppController): void {
  app.calendarDialog.value = null;
}

/** The calendar a command is about: the menu's, else the default one. */
export function targetCalendar(app: AppController): Calendar | null {
  const id = app.calendarMenu.peek()?.id ?? app.calendarTarget.peek() ?? app.defaultCalendar.peek()?.id;
  return app.calendars.peek().find((c) => c.id === id) ?? null;
}

export async function newCalendar(app: AppController, name: string): Promise<void> {
  const session = app.session.peek();
  if (!session) return;
  try {
    const calendar = await session.createCalendar(name);
    app.say(`Added ${calendar.name}.`);
  } catch (e) {
    app.say(`Couldn’t add the calendar: ${message(e)}`, { tone: 'error' });
  }
}

/** Renames the calendar inside its file; the file keeps its name. One undo step. */
export function renameCalendar(app: AppController, id: string, name: string): void {
  const session = app.session.peek();
  const ws = session?.workspace.peek();
  const calendar = ws && calendarById(ws, id);
  const next = name.trim();
  if (!session || !ws || !calendar || calendar.readOnly || !next || next === calendar.name) return;
  const renamed = { ...calendar, name: next, document: withCalendarName(calendar.document, next) };
  session.commit('Rename Calendar', withCalendar(ws, renamed));
}

/** One undo step. */
export function recolourCalendar(app: AppController, id: string, color: string): void {
  const session = app.session.peek();
  const ws = session?.workspace.peek();
  const calendar = ws && calendarById(ws, id);
  if (!session || !ws || !calendar || calendar.readOnly || calendar.color === color) return;
  const recoloured = { ...calendar, color, document: withCalendarColour(calendar.document, color) };
  session.commit('Change Colour', withCalendar(ws, recoloured));
}

/** Makes `id` the folder's default calendar (§13). */
export async function setDefaultCalendar(app: AppController, id: string): Promise<void> {
  const store = app.session.peek()?.store;
  if (!store) return;
  const next = { ...app.folderSettings.peek(), defaultCalendar: id };
  try {
    await writeFolderSettings(store, next);
    app.folderSettings.value = next;
  } catch (e) {
    app.say(`Couldn’t save the default calendar: ${message(e)}`, { tone: 'error' });
  }
}

/** Reads `.daybird/settings.json` again: when the folder opens, and when another window may have changed it. */
export async function loadFolderSettings(app: AppController): Promise<void> {
  const store = app.session.peek()?.store;
  if (!store) return;
  try {
    app.folderSettings.value = await readFolderSettings(store);
  } catch (e) {
    app.say(`Couldn’t read the folder’s settings: ${message(e)}`, { tone: 'error' });
  }
}

/** Moves the calendar's file to the folder's trash after the dialog asked (§7.7). */
export async function deleteCalendar(app: AppController, id: string): Promise<void> {
  const session = app.session.peek();
  const calendar = session && calendarById(session.workspace.peek(), id);
  if (!session || !calendar) return;
  try {
    await session.deleteCalendar(id);
    const hidden = app.settings.peek().hiddenCalendars;
    if (hidden.includes(id)) app.update({ hiddenCalendars: hidden.filter((h) => h !== id) });
    app.say(`Deleted ${calendar.name}. Its file is in the folder’s .daybird/trash.`);
  } catch (e) {
    app.say(`Couldn’t delete ${calendar.name}: ${message(e)}`, { tone: 'error' });
  }
}
