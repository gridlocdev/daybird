import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvent, deleteOccurrence, type Workspace } from '@daybird/core';
import {
  FolderSession,
  MemoryStore,
  TRASH_PATH,
  memorySnapshots,
  type SessionNotice,
  type Snapshot,
} from '../src/index.ts';

const ics = (name: string, events = '') =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//Example//EN\r\nX-WR-CALNAME:${name}\r\nX-APPLE-CALENDAR-COLOR:#3B82F6\r\n${events}END:VCALENDAR\r\n`;

const vevent = (uid: string, title: string, day = '20') =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261101T000000Z\r\nDTSTART:202611${day}T100000\r\nDTEND:202611${day}T110000\r\nSUMMARY:${title}\r\nEND:VEVENT\r\n`;

interface Said {
  readonly text: string;
  readonly options?: SessionNotice;
}

async function open(
  store: MemoryStore,
  options: { windowId?: string; shared?: Map<string, Snapshot>; live?: Set<string> } = {},
) {
  const said: Said[] = [];
  const snapshots = memorySnapshots(options.windowId ?? 'w1', options.shared, options.live);
  let n = 0;
  const session = await FolderSession.open({
    store,
    snapshots,
    say: (text, opts) => said.push(opts ? { text, options: opts } : { text }),
    appVersion: '1.0.0',
    now: () => Date.UTC(2026, 10, 17, 12),
    makeUid: () => `u-${++n}`,
    displayZone: 'UTC',
  });
  return { session, said, snapshots };
}

/** Waits until every file's save has landed. */
async function settled(session: FolderSession) {
  await vi.waitFor(() => {
    for (const s of session.states.value.values())
      expect(['clean', 'removed', 'failed', 'conflict']).toContain(s);
  });
}

function addEvent(
  session: FolderSession,
  calendarId: string,
  title: string,
  ws: Workspace = session.workspace.peek(),
): Workspace {
  return createEvent(ws, session.editContext(), calendarId, {
    title,
    start: { kind: 'date-time', dateTime: '2026-11-21T09:00:00', utc: false, tzid: null },
    end: { kind: 'date-time', dateTime: '2026-11-21T10:00:00', utc: false, tzid: null },
  }).workspace;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('opening a folder', () => {
  it('reads each calendar file and the trash, in name order', async () => {
    const store = new MemoryStore('Calendars', {
      'Work.ics': ics('Work', vevent('a', 'Standup')),
      'Home.ics': ics('Home'),
      'notes.txt': 'not a calendar',
      [TRASH_PATH]: ics('Trash'),
    });
    const { session } = await open(store);
    expect(session.workspace.value.calendars.map((c) => c.name)).toEqual(['Home', 'Work']);
    expect(session.stateOf('Work.ics')).toBe('clean');
    expect(store.text('Work.ics')).toBe(ics('Work', vevent('a', 'Standup')));
  });

  it('gives an empty folder one calendar, written to disk (§3.1)', async () => {
    const store = new MemoryStore();
    const { session } = await open(store);
    await settled(session);
    expect(session.workspace.value.calendars.map((c) => c.id)).toEqual(['Calendar.ics']);
    expect(store.text('Calendar.ics')).toContain('X-WR-CALNAME:Calendar');
  });

  it('saves a file whose events had no UID, with the UIDs added (§3.2)', async () => {
    const noUid = 'BEGIN:VEVENT\r\nDTSTART:20261120T100000\r\nSUMMARY:Lunch\r\nEND:VEVENT\r\n';
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home', noUid) });
    const { session } = await open(store);
    await settled(session);
    expect(store.text('Home.ics')).toContain('UID:u-1');
    expect(store.text('Home.ics')).toContain('PRODID:-//Daybird//Daybird 1.0.0//EN');
  });

  it('never writes a file it could not read, and moves an unreadable trash aside', async () => {
    const store = new MemoryStore('Calendars', {
      'Broken.ics': 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n',
      'Home.ics': ics('Home'),
      [TRASH_PATH]: 'not a calendar',
    });
    const { session } = await open(store);
    await settled(session);
    expect(session.workspace.value.calendars.find((c) => c.id === 'Broken.ics')?.readOnly).toBe(true);
    expect(store.text('Broken.ics')).toBe('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n');
    expect(
      store.paths().some((p) => /^\.daybird\/trash unreadable \d{4}-\d\d-\d\d-\d{6}\.ics$/.test(p)),
    ).toBe(true);
    expect(store.text(TRASH_PATH)).toBeNull();
  });
});

describe('saving', () => {
  it('saves a change at once, and undo saves the file back', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home') });
    const { session } = await open(store);
    expect(session.commit('New Event', addEvent(session, 'Home.ics', 'Dentist'))).toBe(true);
    expect(session.hasUnsaved.value).toBe(true);
    await settled(session);
    expect(store.text('Home.ics')).toContain('SUMMARY:Dentist');
    expect(session.hasUnsaved.value).toBe(false);
    expect(session.undo()).toBe('New Event');
    await settled(session);
    expect(store.text('Home.ics')).not.toContain('Dentist');
    session.redo();
    await settled(session);
    expect(store.text('Home.ics')).toContain('SUMMARY:Dentist');
  });

  it('saves a change made during a save right after it', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home') });
    const { session } = await open(store);
    session.commit('One', addEvent(session, 'Home.ics', 'One'));
    session.commit('Two', addEvent(session, 'Home.ics', 'Two'));
    expect(session.stateOf('Home.ics')).toBe('savingDirty');
    await settled(session);
    expect(store.text('Home.ics')).toContain('SUMMARY:One');
    expect(store.text('Home.ics')).toContain('SUMMARY:Two');
  });

  it('writes deletions to the trash file', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home', vevent('a', 'Lunch')) });
    const { session } = await open(store);
    const ws = deleteOccurrence(
      session.workspace.peek(),
      session.editContext(),
      { calendarId: 'Home.ics', uid: 'a', key: null },
      'all',
    );
    session.commit('Delete Lunch', ws);
    await settled(session);
    expect(store.text('Home.ics')).not.toContain('Lunch');
    expect(store.text(TRASH_PATH)).toContain('SUMMARY:Lunch');
  });

  it('retries a failed save twice, then reports it with Try Again (§3.4)', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home') });
    const { session, said } = await open(store);
    store.failWrites.add('Home.ics');
    session.commit('New Event', addEvent(session, 'Home.ics', 'Dentist'));
    await vi.waitFor(() => expect(session.stateOf('Home.ics')).toBe('failed'), { timeout: 3000 });
    const report = said.at(-1)!;
    expect(report.text).toBe('Couldn’t save Home.');
    expect(report.options?.tone).toBe('error');
    store.failWrites.clear();
    report.options!.action!.run();
    await settled(session);
    expect(said.at(-1)!.text).toBe('Saved.');
    expect(store.text('Home.ics')).toContain('Dentist');
  });
});

describe('changes made elsewhere (§3.5)', () => {
  it('takes a changed file as one undo step, with a notice', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home', vevent('a', 'Lunch')) });
    const { session, said } = await open(store);
    store.touch('Home.ics', ics('Home', vevent('a', 'Lunch') + vevent('b', 'Gym')));
    await session.refresh();
    expect(said.at(-1)!.text).toBe('Updated Home with 1 change made elsewhere.');
    expect(session.workspace.value.calendars[0]!.document.children.length).toBeGreaterThan(5);
    said.at(-1)!.options!.action!.run();
    await settled(session);
    expect(store.text('Home.ics')).not.toContain('Gym');
  });

  it('adds a new calendar file and removes a deleted one', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home'), 'Work.ics': ics('Work') });
    const { session, said } = await open(store);
    store.touch('Trips.ics', ics('Trips'));
    store.touch('Work.ics', null);
    await session.refresh();
    expect(session.workspace.value.calendars.map((c) => c.name)).toEqual(['Home', 'Trips']);
    expect(said.at(-1)!.text).toBe('Work was removed from the folder.');
  });

  it('turns a save over a newer file into a conflict, counting the events that differ', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home', vevent('a', 'Lunch')) });
    const { session } = await open(store);
    store.touch('Home.ics', ics('Home', vevent('a', 'Brunch')));
    session.commit('New Event', addEvent(session, 'Home.ics', 'Dentist'));
    await vi.waitFor(() => expect(session.conflicts.value).toHaveLength(1));
    expect(session.conflicts.value[0]).toEqual({
      path: 'Home.ics',
      name: 'Home',
      reason: 'changed',
      differs: 2,
    });
    expect(store.text('Home.ics')).toContain('Brunch');
  });

  it('Keep Mine writes over the disk; Use Theirs takes the disk', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home'), 'Work.ics': ics('Work') });
    const { session } = await open(store);
    store.touch('Home.ics', ics('Home', vevent('x', 'Theirs')));
    store.touch('Work.ics', ics('Work', vevent('y', 'Theirs')));
    session.commit('Mine', addEvent(session, 'Work.ics', 'Mine', addEvent(session, 'Home.ics', 'Mine')));
    await vi.waitFor(() => expect(session.conflicts.value).toHaveLength(2));
    await session.resolve('Home.ics', 'keepMine');
    await session.resolve('Work.ics', 'useTheirs');
    await settled(session);
    expect(store.text('Home.ics')).toContain('SUMMARY:Mine');
    expect(store.text('Home.ics')).not.toContain('Theirs');
    expect(store.text('Work.ics')).toBe(ics('Work', vevent('y', 'Theirs')));
    expect(session.conflicts.value).toEqual([]);
    // Use Theirs dropped the steps that changed Work, so undo can't write an old version over it.
    session.undo();
    await settled(session);
    expect(store.text('Work.ics')).toContain('Theirs');
  });

  it('Save Mine as a Copy writes a new calendar and takes the disk', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home') });
    const { session } = await open(store);
    store.touch('Home.ics', ics('Home', vevent('x', 'Theirs')));
    session.commit('Mine', addEvent(session, 'Home.ics', 'Mine'));
    await vi.waitFor(() => expect(session.conflicts.value).toHaveLength(1));
    await session.resolve('Home.ics', 'saveCopy');
    await settled(session);
    const copy = store.paths().find((p) => p.startsWith('Home copy '))!;
    expect(copy).toMatch(/^Home copy \d{4}-\d\d-\d\d-\d{6}\.ics$/);
    expect(store.text(copy)).toContain('SUMMARY:Mine');
    expect(store.text(copy)).toContain('X-WR-CALNAME:Home copy');
    expect(store.text('Home.ics')).toContain('Theirs');
    expect(session.workspace.value.calendars.map((c) => c.name)).toEqual(['Home', 'Home copy']);
  });

  it('a file deleted under unsaved changes is a conflict, and Keep Mine writes it back', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home') });
    const { session } = await open(store);
    store.touch('Home.ics', null);
    session.commit('Mine', addEvent(session, 'Home.ics', 'Mine'));
    await vi.waitFor(() => expect(session.conflicts.value[0]?.reason).toBe('deleted'));
    await session.resolve('Home.ics', 'keepMine');
    await settled(session);
    expect(store.text('Home.ics')).toContain('SUMMARY:Mine');
  });
});

describe('recovery (§3.6)', () => {
  it('offers a closed window’s unsaved changes, and Restore saves them', async () => {
    const shared = new Map<string, Snapshot>();
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home') });
    const first = await open(store, { windowId: 'w1', shared });
    store.failWrites.add('Home.ics');
    first.session.commit('Mine', addEvent(first.session, 'Home.ics', 'Unsaved'));
    await vi.waitFor(() => expect(first.session.stateOf('Home.ics')).toBe('retrying'));
    await first.session.flushSnapshot();
    first.session.close();
    store.failWrites.clear();

    const second = await open(store, { windowId: 'w2', shared });
    expect(second.session.recovery.value?.files).toEqual([{ path: 'Home.ics', name: 'Home' }]);
    second.session.restoreRecovery();
    await settled(second.session);
    expect(store.text('Home.ics')).toContain('SUMMARY:Unsaved');
    expect(shared.has('w1')).toBe(false);
  });

  it('restores against the version the snapshot was based on, so a newer file is a conflict', async () => {
    const shared = new Map<string, Snapshot>();
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home') });
    const first = await open(store, { windowId: 'w1', shared });
    store.failWrites.add('Home.ics');
    first.session.commit('Mine', addEvent(first.session, 'Home.ics', 'Unsaved'));
    await vi.waitFor(() => expect(first.session.stateOf('Home.ics')).toBe('retrying'));
    await first.session.flushSnapshot();
    first.session.close();
    store.failWrites.clear();
    store.touch('Home.ics', ics('Home', vevent('x', 'Elsewhere')));

    const second = await open(store, { windowId: 'w2', shared });
    second.session.restoreRecovery();
    await vi.waitFor(() => expect(second.session.conflicts.value).toHaveLength(1));
    expect(store.text('Home.ics')).toContain('Elsewhere');
  });

  it('does not offer the snapshot of a window that is still open', async () => {
    const shared = new Map<string, Snapshot>();
    const live = new Set<string>();
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home') });
    const first = await open(store, { windowId: 'w1', shared, live });
    store.failWrites.add('Home.ics');
    first.session.commit('Mine', addEvent(first.session, 'Home.ics', 'Unsaved'));
    await vi.waitFor(() => expect(first.session.stateOf('Home.ics')).toBe('retrying'));
    await first.session.flushSnapshot();
    const second = await open(store, { windowId: 'w2', shared, live });
    expect(second.session.recovery.value).toBeNull();
    expect(shared.has('w1')).toBe(true);
  });

  it('reports a snapshot that could not be written', async () => {
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home') });
    const { session, said, snapshots } = await open(store);
    store.failWrites.add('Home.ics');
    snapshots.failing = true;
    session.commit('Mine', addEvent(session, 'Home.ics', 'Unsaved'));
    await session.flushSnapshot();
    expect(said.at(-1)!.text).toMatch(/^Couldn’t keep a recovery copy/);
  });

  it('drops the snapshot once every change is saved', async () => {
    const shared = new Map<string, Snapshot>();
    const store = new MemoryStore('Calendars', { 'Home.ics': ics('Home') });
    const { session } = await open(store, { shared });
    session.commit('Mine', addEvent(session, 'Home.ics', 'Saved'));
    await session.flushSnapshot();
    await settled(session);
    await vi.waitFor(() => expect(shared.size).toBe(0));
  });
});
