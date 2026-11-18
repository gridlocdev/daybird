// Deleted calendars in the folder's trash (PRD §7.7) and Export All's zip (PRD §11).
import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  parseTrashedName,
  purgeTrashedCalendars,
  restoreTrashedCalendar,
  trashedCalendars,
  zipFiles,
} from '../src/index.ts';

const ics = (name: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//Example//EN\r\nX-WR-CALNAME:${name}\r\nEND:VCALENDAR\r\n`;

describe('deleted calendars', () => {
  it('reads the old file name and the time from the stamp', () => {
    expect(parseTrashedName('Work 2026-11-17-140501.ics')).toEqual({
      fileName: 'Work.ics',
      deleted: new Date(2026, 10, 17, 14, 5, 1).getTime(),
    });
    expect(parseTrashedName('Work.ics')).toBeNull();
  });

  it('lists them newest first, by the calendar’s own name', async () => {
    const store = new MemoryStore('Calendars', {
      '.daybird/trash/Work 2026-11-01-090000.ics': ics('Office'),
      '.daybird/trash/Home 2026-11-10-090000.ics': 'not a calendar',
      '.daybird/trash/notes.txt': 'x',
    });
    const list = await trashedCalendars(store);
    expect(list.map((t) => [t.name, t.fileName])).toEqual([
      ['Home', 'Home.ics'],
      ['Office', 'Work.ics'],
    ]);
  });

  it('puts one back under its old name, or the next free one', async () => {
    const store = new MemoryStore('Calendars', {
      'Work.ics': ics('Work'),
      '.daybird/trash/Work 2026-11-01-090000.ics': ics('Old Work'),
    });
    const [t] = await trashedCalendars(store);
    expect(await restoreTrashedCalendar(store, t!)).toBe('Work 2.ics');
    expect(await trashedCalendars(store)).toEqual([]);
  });

  it('deletes those older than 30 days', async () => {
    const store = new MemoryStore('Calendars', {
      '.daybird/trash/Old 2026-10-01-090000.ics': ics('Old'),
      '.daybird/trash/New 2026-11-10-090000.ics': ics('New'),
    });
    expect(await purgeTrashedCalendars(store, new Date(2026, 10, 17).getTime())).toBe(1);
    expect((await trashedCalendars(store)).map((t) => t.name)).toEqual(['New']);
  });
});

describe('zip', () => {
  it('stores each file with its name, size and CRC', () => {
    const bytes = zipFiles(
      [
        { name: 'a.ics', text: 'hello' },
        { name: 'Café.ics', text: 'é' },
      ],
      new Date(2026, 10, 17, 14, 0, 0),
    );
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(0x3610a686); // CRC-32 of "hello"
    expect(view.getUint32(18, true)).toBe(5);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const central = view.getUint32(end + 16, true);
    expect(view.getUint32(central, true)).toBe(0x02014b50);
    const name = new TextDecoder().decode(
      bytes.slice(central + 46, central + 46 + view.getUint16(central + 28, true)),
    );
    expect(name).toBe('a.ics');
  });
});
