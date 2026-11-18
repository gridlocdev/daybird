import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  createEvent,
  deleteOccurrence,
  diffStep,
  editOccurrence,
  emptyTrashDocument,
  EMPTY_UNDO,
  findOccurrence,
  fromLocalSeconds,
  loadCalendar,
  occurrencesIn,
  purgeTrash,
  pushStep,
  readEvent,
  redo,
  restoreTrashEntry,
  seriesOf,
  toLocalSeconds,
  trashEntries,
  undo,
  writeCalendar,
  type Calendar,
  type EditContext,
  type Occurrence,
  type Workspace,
} from '@daybird/core';

const ZONE = 'Europe/London';
const NOW = toLocalSeconds('2026-11-17T12:00:00');

function context(): EditContext {
  let n = 0;
  return { now: NOW, displayZone: ZONE, makeUid: () => `uid-${++n}` };
}

function ics(...events: string[][]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//Test//EN', 'X-WR-CALNAME:Home'];
  for (const e of events) lines.push('BEGIN:VEVENT', ...e, 'END:VEVENT');
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function calendar(id: string, text: string): Calendar {
  return loadCalendar(id, text, () => 'filled', []).calendar;
}

function workspace(...calendars: Calendar[]): Workspace {
  return { calendars, trash: emptyTrashDocument() };
}

const at = (iso: string) => toLocalSeconds(iso);
const range = (from: string, to: string, ws: Workspace) =>
  occurrencesIn(ws.calendars, at(from), at(to), ZONE);
const starts = (os: Occurrence[]) => os.map((o) => fromLocalSeconds(o.start));

function sound(ws: Workspace): void {
  expect(checkInvariants(ws, ZONE)).toEqual([]);
}

const WEEKLY = [
  'UID:weekly',
  'SUMMARY:Standup',
  'DTSTART;TZID=Europe/London:20261102T090000',
  'DTEND;TZID=Europe/London:20261102T093000',
  'RRULE:FREQ=WEEKLY;COUNT=6',
];
const weeklyWs = () => workspace(calendar('Home.ics', ics(WEEKLY)));
const keyOf = (local: string) => at(local);

describe('loading', () => {
  it('reads the name and colour, and fills in missing UIDs', () => {
    const loaded = loadCalendar(
      'Home.ics',
      ics(['SUMMARY:No uid', 'DTSTART:20261117T090000Z']),
      () => 'new-uid',
      [],
    );
    expect(loaded.changed).toBe(true);
    expect(loaded.calendar.name).toBe('Home');
    expect(seriesOf(loaded.calendar.document).map((s) => s.uid)).toEqual(['new-uid']);
    expect(loaded.calendar.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps an unreadable file read-only with its error', () => {
    const loaded = loadCalendar('Bad.ics', 'nonsense', () => 'x', []);
    expect(loaded.calendar.readOnly).toBe(true);
    expect(loaded.calendar.error?.message).toBeTruthy();
    expect(loaded.calendar.name).toBe('Bad');
  });
});

describe('reading events', () => {
  const read = (lines: string[]) =>
    readEvent(seriesOf(calendar('a.ics', ics(lines))[`document`])[0]!.master!);

  it('takes the end from DURATION, or a zero-length timed event, or a one-day all-day event', () => {
    expect(read(['UID:a', 'DTSTART:20261117T090000Z', 'DURATION:PT1H30M']).end).toEqual({
      kind: 'date-time',
      dateTime: '2026-11-17T10:30:00',
      utc: true,
      tzid: null,
    });
    expect(read(['UID:a', 'DTSTART:20261117T090000Z']).end).toEqual(
      read(['UID:a', 'DTSTART:20261117T090000Z']).start,
    );
    expect(read(['UID:a', 'DTSTART;VALUE=DATE:20261117']).end).toEqual({ kind: 'date', date: '2026-11-18' });
  });

  it('reads an end before the start as the start, and says so', () => {
    const e = read(['UID:a', 'DTSTART:20261117T090000Z', 'DTEND:20261117T080000Z']);
    expect(e.end).toEqual(e.start);
    expect(e.problems).toContain('The end was before the start, so it was set to the start.');
  });

  it('reads text, reminders and what it couldn’t read', () => {
    const e = read([
      'UID:a',
      'SUMMARY:Lunch\\, with Sam',
      'DTSTART:20261117T120000Z',
      'RRULE:FREQ=SOMETIMES',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:EMAIL',
      'TRIGGER:-PT1H',
      'END:VALARM',
    ]);
    expect(e.title).toBe('Lunch, with Sam');
    expect(e.reminders).toEqual([{ kind: 'before', seconds: 900 }]);
    expect(e.problems[0]).toMatch(/Couldn't read the repeat rule/);
  });
});

describe('occurrences', () => {
  it('keeps a weekly event at 9:00 on its own clock across a change of offset', () => {
    const os = range('2026-10-01T00:00:00', '2027-01-01T00:00:00', weeklyWs());
    expect(os.map((o) => o.ownStart)).toEqual([
      '2026-11-02T09:00:00',
      '2026-11-09T09:00:00',
      '2026-11-16T09:00:00',
      '2026-11-23T09:00:00',
      '2026-11-30T09:00:00',
      '2026-12-07T09:00:00',
    ]);
    const ny = workspace(
      calendar(
        'a.ics',
        ics(['UID:ny', 'DTSTART;TZID=America/New_York:20261025T090000', 'RRULE:FREQ=WEEKLY;COUNT=2']),
      ),
    );
    // New York leaves daylight time on Nov 1: 9:00 is 13:00Z, then 14:00Z.
    expect(starts(range('2026-10-01T00:00:00', '2027-01-01T00:00:00', ny))).toEqual([
      '2026-10-25T13:00:00',
      '2026-11-01T14:00:00',
    ]);
  });

  it('replaces an occurrence with its override and skips EXDATEs', () => {
    const ws = workspace(
      calendar(
        'a.ics',
        ics(
          [...WEEKLY, 'EXDATE;TZID=Europe/London:20261109T090000'],
          [
            'UID:weekly',
            'RECURRENCE-ID;TZID=Europe/London:20261116T090000',
            'SUMMARY:Moved',
            'DTSTART;TZID=Europe/London:20261116T140000',
            'DTEND;TZID=Europe/London:20261116T150000',
          ],
        ),
      ),
    );
    sound(ws);
    const os = range('2026-11-01T00:00:00', '2026-11-30T00:00:00', ws);
    expect(os.map((o) => [o.ownStart, o.title, o.isOverride])).toEqual([
      ['2026-11-02T09:00:00', 'Standup', false],
      ['2026-11-16T14:00:00', 'Moved', true],
      ['2026-11-23T09:00:00', 'Standup', false],
    ]);
    expect(os[1]?.key).toBe(keyOf('2026-11-16T09:00:00'));
  });

  it('shows an all-day event over its days, and one that started before the range', () => {
    const ws = workspace(
      calendar(
        'a.ics',
        ics(['UID:trip', 'SUMMARY:Trip', 'DTSTART;VALUE=DATE:20261114', 'DTEND;VALUE=DATE:20261118']),
      ),
    );
    const [trip] = range('2026-11-16T00:00:00', '2026-11-17T00:00:00', ws);
    expect([trip?.allDay, trip?.startDate, trip?.endDate]).toEqual([true, '2026-11-14', '2026-11-18']);
    expect(range('2026-11-18T00:00:00', '2026-11-19T00:00:00', ws)).toEqual([]);
  });

  it('says when a time zone is unknown, and when a rule repeats too often', () => {
    const ws = workspace(
      calendar(
        'a.ics',
        ics(
          ['UID:z', 'DTSTART;TZID=Nowhere/Special:20261117T090000'],
          ['UID:s', 'DTSTART:20261117T000000Z', 'RRULE:FREQ=SECONDLY'],
        ),
      ),
    );
    const os = range('2026-11-17T00:00:00', '2026-11-18T00:00:00', ws);
    expect(os.find((o) => o.uid === 'z')?.problems).toContain(
      'Unknown time zone Nowhere/Special; shown in local time.',
    );
    const s = os.filter((o) => o.uid === 's');
    expect(s.length).toBeGreaterThan(1000);
    expect(s[0]?.problems).toContain('This event repeats too often to show every time.');
  });
});

describe('creating and editing', () => {
  it('creates an event with stamps and a VTIMEZONE for its zone', () => {
    const ctx = context();
    const { workspace: ws, ref } = createEvent(workspace(calendar('Home.ics', ics())), ctx, 'Home.ics', {
      title: 'Dentist',
      start: { kind: 'date-time', dateTime: '2026-11-20T10:00:00', utc: false, tzid: 'America/New_York' },
      end: { kind: 'date-time', dateTime: '2026-11-20T11:00:00', utc: false, tzid: 'America/New_York' },
    });
    sound(ws);
    const text = writeCalendar(ws.calendars[0]!.document);
    expect(text).toContain('BEGIN:VTIMEZONE\r\nTZID:America/New_York');
    expect(text).toContain(
      'UID:uid-1\r\nDTSTAMP:20261117T120000Z\r\nCREATED:20261117T120000Z\r\nLAST-MODIFIED:20261117T120000Z',
    );
    expect(findOccurrence(ws.calendars[0]!, ref.uid, null, ZONE)?.title).toBe('Dentist');
  });

  it('changes one occurrence with an override, and raises SEQUENCE only for a time change', () => {
    const ws0 = weeklyWs();
    const ref = { calendarId: 'Home.ics', uid: 'weekly', key: keyOf('2026-11-09T09:00:00') };
    const { workspace: ws } = editOccurrence(ws0, context(), ref, { title: 'Retro' }, 'this');
    sound(ws);
    const series = seriesOf(ws.calendars[0]!.document)[0]!;
    expect(series.master).toBe(seriesOf(ws0.calendars[0]!.document)[0]!.master);
    expect(series.overrides).toHaveLength(1);
    const text = writeCalendar(ws.calendars[0]!.document);
    expect(text).toContain('RECURRENCE-ID;TZID=Europe/London:20261109T090000');
    expect(text).not.toContain('SEQUENCE');
    const titles = range('2026-11-01T00:00:00', '2026-11-20T00:00:00', ws).map((o) => o.title);
    expect(titles).toEqual(['Standup', 'Retro', 'Standup']);

    const moved = editOccurrence(
      ws,
      context(),
      ref,
      { start: { kind: 'date-time', dateTime: '2026-11-09T10:00:00', utc: false, tzid: ZONE } },
      'this',
    );
    expect(writeCalendar(moved.workspace.calendars[0]!.document)).toContain('SEQUENCE:1');
  });

  it('records nothing for an edit that changes nothing', () => {
    const ws0 = weeklyWs();
    const { workspace: ws } = editOccurrence(
      ws0,
      context(),
      { calendarId: 'Home.ics', uid: 'weekly', key: keyOf('2026-11-09T09:00:00') },
      { title: 'Standup' },
      'this',
    );
    expect(ws).toEqual(ws0);
    expect(diffStep('Nothing', ws0, ws)).toBeNull();
  });

  it('moves every occurrence with All Events, and overrides that kept the old time move too', () => {
    let ws = weeklyWs();
    const ctx = context();
    const kept = { calendarId: 'Home.ics', uid: 'weekly', key: keyOf('2026-11-16T09:00:00') };
    const moved = { calendarId: 'Home.ics', uid: 'weekly', key: keyOf('2026-11-23T09:00:00') };
    ws = editOccurrence(ws, ctx, kept, { title: 'Kept time' }, 'this').workspace;
    ws = editOccurrence(
      ws,
      ctx,
      moved,
      {
        start: { kind: 'date-time', dateTime: '2026-11-23T15:00:00', utc: false, tzid: ZONE },
        end: { kind: 'date-time', dateTime: '2026-11-23T15:30:00', utc: false, tzid: ZONE },
      },
      'this',
    ).workspace;
    const first = { calendarId: 'Home.ics', uid: 'weekly', key: keyOf('2026-11-02T09:00:00') };
    ws = editOccurrence(
      ws,
      ctx,
      first,
      {
        title: 'Daily',
        start: { kind: 'date-time', dateTime: '2026-11-02T10:00:00', utc: false, tzid: ZONE },
        end: { kind: 'date-time', dateTime: '2026-11-02T10:30:00', utc: false, tzid: ZONE },
      },
      'all',
    ).workspace;
    sound(ws);
    const os = range('2026-11-01T00:00:00', '2026-12-31T00:00:00', ws);
    expect(os.map((o) => [o.ownStart.slice(5, 16), o.title])).toEqual([
      ['11-02T10:00', 'Daily'],
      ['11-09T10:00', 'Daily'],
      ['11-16T10:00', 'Kept time'],
      ['11-23T15:00', 'Daily'],
      ['11-30T10:00', 'Daily'],
      ['12-07T10:00', 'Daily'],
    ]);
  });

  it('splits with This and Future: the rule ends, a new series takes the rest and the later overrides', () => {
    let ws = weeklyWs();
    const ctx = context();
    ws = editOccurrence(
      ws,
      ctx,
      { calendarId: 'Home.ics', uid: 'weekly', key: keyOf('2026-11-30T09:00:00') },
      { title: 'Late one' },
      'this',
    ).workspace;
    const split = editOccurrence(
      ws,
      ctx,
      { calendarId: 'Home.ics', uid: 'weekly', key: keyOf('2026-11-16T09:00:00') },
      { title: 'New standup' },
      'future',
    );
    ws = split.workspace;
    sound(ws);
    const text = writeCalendar(ws.calendars[0]!.document);
    expect(text).toContain('RRULE:FREQ=WEEKLY;UNTIL=20261116T085959Z');
    expect(text).toContain('RRULE:FREQ=WEEKLY;COUNT=4');
    expect(split.ref.uid).not.toBe('weekly');
    expect(split.ref.key).toBe(keyOf('2026-11-16T09:00:00'));
    const os = range('2026-11-01T00:00:00', '2026-12-31T00:00:00', ws);
    expect(os.map((o) => [o.ownStart.slice(5, 10), o.title, o.uid === 'weekly'])).toEqual([
      ['11-02', 'Standup', true],
      ['11-09', 'Standup', true],
      ['11-16', 'New standup', false],
      ['11-23', 'New standup', false],
      ['11-30', 'Late one', false],
      ['12-07', 'New standup', false],
    ]);
  });

  it('moves an event to another calendar, keeping one copy', () => {
    const ws0 = workspace(calendar('Home.ics', ics(WEEKLY)), calendar('Work.ics', ics()));
    const { workspace: ws, ref } = editOccurrence(
      ws0,
      context(),
      { calendarId: 'Home.ics', uid: 'weekly', key: keyOf('2026-11-02T09:00:00') },
      {},
      'all',
      'Work.ics',
    );
    sound(ws);
    expect(seriesOf(ws.calendars[0]!.document)).toEqual([]);
    expect(seriesOf(ws.calendars[1]!.document).map((s) => s.uid)).toEqual(['weekly']);
    expect(ref.calendarId).toBe('Work.ics');
  });
});

describe('deleting, the trash and undo', () => {
  it('skips one occurrence with EXDATE, even the first, and restores it', () => {
    let ws = weeklyWs();
    const ctx = context();
    ws = deleteOccurrence(
      ws,
      ctx,
      { calendarId: 'Home.ics', uid: 'weekly', key: keyOf('2026-11-02T09:00:00') },
      'this',
    );
    sound(ws);
    const text = writeCalendar(ws.calendars[0]!.document);
    expect(text).toContain('DTSTART;TZID=Europe/London:20261102T090000');
    expect(text).toContain('EXDATE;TZID=Europe/London:20261102T090000');
    const [entry] = trashEntries(ws.trash);
    expect([entry?.kind, entry?.calendarId, entry?.title]).toEqual(['occurrence', 'Home.ics', 'Standup']);
    ws = restoreTrashEntry(ws, ctx, entry!.id, 'Home.ics');
    sound(ws);
    expect(trashEntries(ws.trash)).toEqual([]);
    expect(range('2026-11-01T00:00:00', '2026-11-03T00:00:00', ws)).toHaveLength(1);
  });

  it('trashes a whole series, and restores it under a new UID when its UID is taken', () => {
    const ctx = context();
    let ws = deleteOccurrence(
      weeklyWs(),
      ctx,
      { calendarId: 'Home.ics', uid: 'weekly', key: keyOf('2026-11-09T09:00:00') },
      'all',
    );
    expect(seriesOf(ws.calendars[0]!.document)).toEqual([]);
    const id = trashEntries(ws.trash)[0]!.id;
    ws = { ...ws, calendars: [calendar('Home.ics', ics(WEEKLY))] };
    ws = restoreTrashEntry(ws, ctx, id, 'Home.ics');
    sound(ws);
    expect(seriesOf(ws.calendars[0]!.document).map((s) => s.uid)).toEqual(['weekly', 'uid-2']);
  });

  it('restores into the default calendar when its own is gone, and purges old entries', () => {
    const ctx = context();
    let ws = deleteOccurrence(weeklyWs(), ctx, { calendarId: 'Home.ics', uid: 'weekly', key: null }, 'all');
    const id = trashEntries(ws.trash)[0]!.id;
    const restored = restoreTrashEntry(
      { ...ws, calendars: [calendar('Work.ics', ics())] },
      ctx,
      id,
      'Work.ics',
    );
    expect(seriesOf(restored.calendars[0]!.document)).toHaveLength(1);
    expect(trashEntries(purgeTrash(ws, NOW + 29 * 86_400).trash)).toHaveLength(1);
    ws = purgeTrash(ws, NOW + 31 * 86_400);
    expect(trashEntries(ws.trash)).toEqual([]);
  });

  it('ends the rule with This and Future, trashing the rest', () => {
    const ws = deleteOccurrence(
      weeklyWs(),
      context(),
      { calendarId: 'Home.ics', uid: 'weekly', key: keyOf('2026-11-23T09:00:00') },
      'future',
    );
    sound(ws);
    expect(range('2026-11-01T00:00:00', '2027-01-01T00:00:00', ws)).toHaveLength(3);
    expect(trashEntries(ws.trash)[0]?.kind).toBe('series');
  });

  it('undoes and redoes exactly the files a step changed', () => {
    const ws0 = workspace(calendar('Home.ics', ics(WEEKLY)), calendar('Work.ics', ics()));
    const ws1 = deleteOccurrence(ws0, context(), { calendarId: 'Home.ics', uid: 'weekly', key: null }, 'all');
    const stack = pushStep(EMPTY_UNDO, diffStep('Deleted Standup', ws0, ws1));
    expect(stack.done[0]?.before.has('Work.ics')).toBe(false);
    const undone = undo(ws1, stack);
    expect(undone?.workspace.calendars[0]).toBe(ws0.calendars[0]);
    expect(undone?.workspace.trash).toBe(ws0.trash);
    expect(undone?.changed).toEqual(['Home.ics']);
    const redone = redo(undone!.workspace, undone!.stack);
    expect(redone?.workspace.calendars[0]).toBe(ws1.calendars[0]);
  });
});
