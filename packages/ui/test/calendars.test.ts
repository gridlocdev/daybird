// Adding, deleting and choosing calendars in the folder (PRD §5.2, §7.7, §13).
import { describe, expect, it, vi } from 'vitest';
import { createEvent, withCalendarName, withCalendar, calendarById } from '@daybird/core';
import {
  FolderSession,
  MemoryStore,
  defaultCalendarOf,
  memorySnapshots,
  parseFolderSettings,
  readFolderSettings,
  writeFolderSettings,
} from '../src/index.ts';

const ics = (name: string, events = '') =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//Example//EN\r\nX-WR-CALNAME:${name}\r\nX-APPLE-CALENDAR-COLOR:#3B82F6\r\n${events}END:VCALENDAR\r\n`;

async function open(store: MemoryStore) {
  let n = 0;
  return FolderSession.open({
    store,
    snapshots: memorySnapshots('w1'),
    say: () => undefined,
    appVersion: '1.0.0',
    now: () => Date.UTC(2026, 10, 17, 12),
    makeUid: () => `u-${++n}`,
    displayZone: 'UTC',
  });
}

async function settled(session: FolderSession) {
  await vi.waitFor(() => {
    for (const s of session.states.value.values()) expect(['clean', 'removed']).toContain(s);
  });
}

describe('calendars in the folder', () => {
  it('adds a calendar in a file of its own, with a colour not yet used', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home') });
    const session = await open(store);
    const trips = await session.createCalendar('Trips');
    const again = await session.createCalendar('Trips');
    expect([trips.id, again.id]).toEqual(['Trips.ics', 'Trips 2.ics']);
    expect(store.text('Trips.ics')).toContain('X-WR-CALNAME:Trips');
    expect(trips.color).not.toBe(again.color);
    expect(session.workspace.peek().calendars.map((c) => c.name)).toEqual(['Home', 'Trips', 'Trips']);
    expect(session.undoStack.peek().done).toHaveLength(0);
    session.close();
  });

  it('moves a deleted calendar’s file to the trash folder and forgets its undo steps', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home'), 'Work.ics': ics('Work') });
    const session = await open(store);
    const ws = createEvent(session.workspace.peek(), session.editContext(), 'Work.ics', {
      title: 'Standup',
      start: { kind: 'date-time', dateTime: '2026-11-21T09:00:00', utc: false, tzid: null },
      end: { kind: 'date-time', dateTime: '2026-11-21T10:00:00', utc: false, tzid: null },
    }).workspace;
    session.commit('New Event', ws);
    await settled(session);
    await session.deleteCalendar('Work.ics');
    expect(store.text('Work.ics')).toBeNull();
    const trashed = store.paths().filter((p) => p.startsWith('.daybird/trash/'));
    // Stamped in the machine's own time.
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toMatch(/^\.daybird\/trash\/Work 2026-11-1[67]-\d{6}\.ics$/);
    expect(store.text(trashed[0]!)).toContain('SUMMARY:Standup');
    expect(session.workspace.peek().calendars.map((c) => c.id)).toEqual(['Home.ics']);
    expect(session.undoStack.peek().done).toHaveLength(0);
    await session.refresh();
    expect(session.workspace.peek().calendars.map((c) => c.id)).toEqual(['Home.ics']);
    session.close();
  });

  it('renames a calendar as an undo step, saved to its file', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home') });
    const session = await open(store);
    const home = calendarById(session.workspace.peek(), 'Home.ics')!;
    const renamed = { ...home, name: 'Family', document: withCalendarName(home.document, 'Family') };
    session.commit('Rename Calendar', withCalendar(session.workspace.peek(), renamed));
    await settled(session);
    expect(store.text('Home.ics')).toContain('X-WR-CALNAME:Family');
    session.undo();
    await settled(session);
    expect(store.text('Home.ics')).toContain('X-WR-CALNAME:Home');
    session.close();
  });
});

describe('the folder’s settings', () => {
  it('reads what was written, and defaults for a missing or broken file', async () => {
    const store = new MemoryStore('Calendars', {});
    expect(await readFolderSettings(store)).toEqual({ defaultCalendar: null });
    await writeFolderSettings(store, { defaultCalendar: 'Work.ics' });
    expect(await readFolderSettings(store)).toEqual({ defaultCalendar: 'Work.ics' });
    expect(parseFolderSettings('{oops')).toEqual({ defaultCalendar: null });
    expect(parseFolderSettings('{"defaultCalendar": 4}')).toEqual({ defaultCalendar: null });
  });

  it('falls back to the first writable calendar by name when the default is gone or unreadable', () => {
    const cal = (id: string, name: string, readOnly = false) =>
      ({ id, name, readOnly }) as Parameters<typeof defaultCalendarOf>[0][number];
    const calendars = [cal('W.ics', 'Work'), cal('H.ics', 'Home'), cal('B.ics', 'Broken', true)];
    expect(defaultCalendarOf(calendars, 'W.ics')?.id).toBe('W.ics');
    expect(defaultCalendarOf(calendars, 'Gone.ics')?.id).toBe('H.ics');
    expect(defaultCalendarOf(calendars, 'B.ics')?.id).toBe('H.ics');
    expect(defaultCalendarOf([], null)).toBeNull();
  });
});
