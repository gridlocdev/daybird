/** Import… and Export (PRD §11). */
import {
  calendarById,
  importEvents,
  importableSeries,
  readCalendar,
  todayIn,
  withDaybirdStamp,
  writeCalendar,
  type Calendar,
} from '@daybird/core';
import { zipFiles } from '@daybird/ui';
import type { AppController, ImportOffer } from './controller.ts';
import { pickFile, saveFile } from './files.ts';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** ⇧⌘I: picks an `.ics` file and asks which calendar takes its events. */
export async function importFile(app: AppController): Promise<void> {
  const file = await pickFile('.ics,text/calendar');
  if (!file) return;
  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    app.say(`Couldn’t read ${file.name}: ${message(e)}`, { tone: 'error' });
    return;
  }
  offerImport(app, file.name, text);
}

/** Reads a file's text and, when it has events, opens the Import dialog. */
export function offerImport(app: AppController, fileName: string, text: string): void {
  const read = readCalendar(text);
  if (!read.ok) {
    app.say(`Couldn’t import ${fileName}: ${read.error.message}`, { tone: 'error' });
    return;
  }
  const count = importableSeries(read.calendar).length;
  if (!count) {
    app.say(`${fileName} has no events.`);
    return;
  }
  app.importOffer.value = { fileName, document: read.calendar, count };
}

/** The Import dialog's answer: a calendar's id, or null for a new calendar named after the file. */
export async function importInto(
  app: AppController,
  offer: ImportOffer,
  calendarId: string | null,
): Promise<void> {
  app.importOffer.value = null;
  const session = app.session.peek();
  if (!session) return;
  let id = calendarId;
  try {
    if (id === null) id = (await session.createCalendar(offer.fileName.replace(/\.ics$/i, ''))).id;
  } catch (e) {
    app.say(`Couldn’t add the calendar: ${message(e)}`, { tone: 'error' });
    return;
  }
  const ws = session.workspace.peek();
  const name = calendarById(ws, id)?.name ?? '';
  const r = importEvents(ws, session.editContext(), id, offer.document);
  if (!r.added) {
    app.say(`All ${plural(r.skipped, 'event')} in ${offer.fileName} are already in ${name}.`);
    return;
  }
  session.commit('Import', r.workspace);
  const already = r.skipped ? ` (${r.skipped} already there)` : '';
  app.say(`Imported ${plural(r.added, 'event')}${already}.`, {
    action: { label: 'Undo', run: () => app.undo() },
  });
}

const calendarText = (app: AppController, c: Calendar) =>
  writeCalendar(withDaybirdStamp(c.document, app.version));

/** Saves a copy of one calendar's file. */
export function exportCalendar(app: AppController, c: Calendar): void {
  saveFile(c.id.split('/').pop() ?? c.id, calendarText(app, c), 'text/calendar');
}

/** Saves a `.zip` of every calendar file. */
export function exportAll(app: AppController): void {
  const calendars = app.calendars.peek().filter((c) => !c.error);
  const files = calendars.map((c) => ({ name: c.id.split('/').pop() ?? c.id, text: calendarText(app, c) }));
  const day = todayIn(app.now.peek(), app.displayZone);
  saveFile(`Daybird Calendars ${day}.zip`, zipFiles(files, new Date(app.now.peek())), 'application/zip');
}
