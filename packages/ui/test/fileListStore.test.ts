import { describe, expect, it } from 'vitest';
import {
  FileListStore,
  FolderSession,
  NotFoundError,
  ReadOnlyError,
  decodeText,
  memorySnapshots,
  type CalendarStore,
} from '../src/index.ts';

const ics = (name: string, events = '') =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//Example//EN\r\nX-WR-CALNAME:${name}\r\n${events}END:VCALENDAR\r\n`;

/** An event with no UID: reading gives it one, which a writable folder would save. */
const noUid = `BEGIN:VEVENT\r\nDTSTART:20261120T100000\r\nDTEND:20261120T110000\r\nSUMMARY:Standup\r\nEND:VEVENT\r\n`;

/** A file as `<input webkitdirectory>` hands it over: its path starts with the picked folder's name. */
function picked(path: string, text: string): File {
  const file = new File([text], path.slice(path.lastIndexOf('/') + 1), { lastModified: 1_700_000_000_000 });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

const folder = () =>
  new FileListStore([
    picked('Calendars/Work.ics', ics('Work', noUid)),
    picked('Calendars/Home.ics', ics('Home')),
    picked('Calendars/.daybird/trash.ics', 'not a calendar'),
    picked('Calendars/old/2019.ics', ics('2019')),
  ]);

describe('a folder picked with the file input', () => {
  it('is named after the folder and lists each folder’s own entries, with paths inside it', async () => {
    const store = folder();
    expect([store.name, store.readOnly, store.isPrivate]).toEqual(['Calendars', true, false]);
    const top = await store.list('');
    expect(top.map((e) => `${e.kind} ${e.path}`).sort()).toEqual([
      'dir .daybird',
      'dir old',
      'file Home.ics',
      'file Work.ics',
    ]);
    expect((await store.list('.daybird')).map((e) => e.path)).toEqual(['.daybird/trash.ics']);
    expect(await store.list('missing')).toEqual([]);
    expect(decodeText((await store.read('Home.ics')).bytes)).toBe(ics('Home'));
  });

  it('rejects a missing file and every write, without throwing', async () => {
    const store: CalendarStore = folder();
    await expect(store.read('Gone.ics')).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.write('Work.ics', new Uint8Array())).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(store.move('Work.ics', 'Job.ics')).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(store.remove('Work.ics')).rejects.toBeInstanceOf(ReadOnlyError);
  });

  it('opens read-only: shows the calendars and writes, commits and offers nothing', async () => {
    const store = folder();
    const said: string[] = [];
    const session = await FolderSession.open({
      store,
      snapshots: memorySnapshots('w1'),
      say: (text) => said.push(text),
      appVersion: '1.0.0',
      displayZone: 'UTC',
    });
    expect(session.store.readOnly).toBe(true);
    const ws = session.workspace.peek();
    expect(ws.calendars.map((c) => c.name).sort()).toEqual(['Home', 'Work']);
    expect(ws.calendars.every((c) => !c.readOnly)).toBe(true);
    expect(session.recovery.peek()).toBeNull();
    expect(session.hasUnsaved.peek()).toBe(false);
    expect(session.commit('Rename Calendar', { ...ws, calendars: [] })).toBe(false);
    expect(session.workspace.peek()).toBe(ws);
    await expect(session.createCalendar('New')).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(session.deleteCalendar('Work.ics')).rejects.toBeInstanceOf(ReadOnlyError);
    expect(said).toEqual([]);
  });

  it('an empty folder opens with no calendars rather than making one', async () => {
    const store = new FileListStore([picked('Empty/notes.txt', 'hi')]);
    const session = await FolderSession.open({
      store,
      snapshots: memorySnapshots('w1'),
      say: () => undefined,
      appVersion: '1.0.0',
      displayZone: 'UTC',
    });
    expect(session.workspace.peek().calendars).toEqual([]);
  });
});
