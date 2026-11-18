/** The Trash view's actions (PRD §7.7): show it, restore, delete for good, empty. */
import { batch } from '@preact/signals';
import { deleteTrashEntry, emptyTrash, restoreTrashEntry, trashEntries } from '@daybird/core';
import {
  purgeTrashedCalendars,
  restoreTrashedCalendar,
  trashedCalendars,
  type TrashedCalendar,
} from '@daybird/ui';
import type { AppController } from './controller.ts';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** How many items the trash holds: deleted events and deleted calendars. */
export function trashCount(app: AppController): number {
  const ws = app.session.value?.workspace.value;
  return (ws ? trashEntries(ws.trash).length : 0) + app.trashedCalendars.value.length;
}

/** Reads the deleted calendars again; when `purge`, first deletes those older than 30 days (on opening). */
export async function loadTrashedCalendars(app: AppController, purge = false): Promise<void> {
  const store = app.session.peek()?.store;
  if (!store) return;
  try {
    if (purge) await purgeTrashedCalendars(store, app.now.peek());
    app.trashedCalendars.value = await trashedCalendars(store);
  } catch (e) {
    app.say(`Couldn’t read the deleted calendars: ${message(e)}`, { tone: 'error' });
  }
}

export function showTrash(app: AppController, shown = true): void {
  batch(() => {
    app.trashMenu.value = null;
    app.search.value = '';
    app.trashShown.value = shown;
  });
  if (shown) void loadTrashedCalendars(app);
}

/** Puts a deleted event back where it came from, or in the default calendar. One undo step. */
export function restoreEntry(app: AppController, id: string): void {
  const session = app.session.peek();
  if (!session) return;
  const ws = session.workspace.peek();
  const entry = trashEntries(ws.trash).find((e) => e.id === id);
  const fallback = app.defaultCalendar.peek()?.id ?? '';
  if (!entry) return;
  if (session.commit('Restore Event', restoreTrashEntry(ws, session.editContext(), id, fallback)))
    app.say(`Restored ${entry.title || 'New Event'}.`, { action: { label: 'Undo', run: () => app.undo() } });
  else app.say(`Couldn’t restore ${entry.title || 'the event'}: no calendar can take it.`, { tone: 'error' });
}

export function deleteEntry(app: AppController, id: string): void {
  const session = app.session.peek();
  if (session) session.commit('Delete Permanently', deleteTrashEntry(session.workspace.peek(), id));
}

/** Moves a deleted calendar's file back into the folder and opens it. */
export async function restoreCalendar(app: AppController, t: TrashedCalendar): Promise<void> {
  const session = app.session.peek();
  if (!session) return;
  try {
    await restoreTrashedCalendar(session.store, t);
    await session.refresh();
    await loadTrashedCalendars(app);
    app.say(`Restored ${t.name}.`);
  } catch (e) {
    app.say(`Couldn’t restore ${t.name}: ${message(e)}`, { tone: 'error' });
  }
}

export async function deleteCalendarFile(app: AppController, t: TrashedCalendar): Promise<void> {
  const store = app.session.peek()?.store;
  if (!store) return;
  try {
    await store.remove(t.path);
  } catch (e) {
    app.say(`Couldn’t delete ${t.name}: ${message(e)}`, { tone: 'error' });
  }
  await loadTrashedCalendars(app);
}

/** Deletes every event and calendar in the trash. */
export async function emptyAll(app: AppController): Promise<void> {
  const session = app.session.peek();
  if (!session) return;
  session.commit('Empty Trash', emptyTrash(session.workspace.peek()));
  for (const t of app.trashedCalendars.peek()) await deleteCalendarFile(app, t);
  await loadTrashedCalendars(app);
  app.say('Emptied the trash.');
}
