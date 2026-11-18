import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  emptyTrashDocument,
  importEvents,
  loadCalendar,
  matchesSearch,
  nearestFirst,
  readCalendar,
  searchKey,
  searchRange,
  seriesOf,
  type ComponentNode,
  type EditContext,
  type Workspace,
} from '@daybird/core';

function ics(extra: string[], ...events: string[][]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//Test//EN', ...extra];
  for (const e of events) lines.push('BEGIN:VEVENT', ...e, 'END:VEVENT');
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

const doc = (text: string): ComponentNode => {
  const r = readCalendar(text);
  if (!r.ok) throw new Error('unreadable');
  return r.calendar;
};

function context(): EditContext {
  let n = 0;
  return { now: 0, displayZone: 'UTC', makeUid: () => `new-${++n}` };
}

const event = (uid: string | null, title: string) => [
  ...(uid ? [`UID:${uid}`] : []),
  `SUMMARY:${title}`,
  'DTSTART:20261117T090000Z',
  'DTEND:20261117T100000Z',
];

const ZONE_LINES = [
  'BEGIN:VTIMEZONE',
  'TZID:Custom/Zone',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0500',
  'END:STANDARD',
  'END:VTIMEZONE',
];

describe('search', () => {
  it('folds case and accents', () => {
    expect(searchKey('  Café  ÉCOLE ')).toBe('cafe ecole');
  });

  it('matches every word in the title, location or notes', () => {
    const item = { title: 'Lunch with Zoë', location: 'Café Nord', notes: 'Bring the plans' };
    expect(matchesSearch(item, 'zoe')).toBe(true);
    expect(matchesSearch(item, 'cafe plans')).toBe(true);
    expect(matchesSearch(item, 'lunch dinner')).toBe(false);
    expect(matchesSearch(item, '   ')).toBe(false);
  });

  it('looks a year back and two years ahead', () => {
    expect(searchRange('2026-11-17')).toEqual({ start: '2025-11-17', end: '2028-11-18' });
  });

  it('lists today and later first, then earlier days latest first', () => {
    const days = ['2026-11-01', '2026-11-16', '2026-11-17', '2026-12-01'].map((date) => ({ date }));
    expect(nearestFirst(days, '2026-11-17').map((d) => d.date)).toEqual([
      '2026-11-17',
      '2026-12-01',
      '2026-11-16',
      '2026-11-01',
    ]);
  });
});

describe('import', () => {
  const home = () =>
    loadCalendar('Home.ics', ics(['X-WR-CALNAME:Home'], event('a', 'Standup')), () => 'x', []).calendar;
  const ws = (): Workspace => ({ calendars: [home()], trash: emptyTrashDocument() });

  it('adds new events, skips UIDs already there and gives UID-less events one each', () => {
    const source = doc(
      ics([], event('a', 'Standup'), event('b', 'Lunch'), event(null, 'One'), event(null, 'Two')),
    );
    const r = importEvents(ws(), context(), 'Home.ics', source);
    expect(r.added).toBe(3);
    expect(r.skipped).toBe(1);
    const uids = seriesOf(r.workspace.calendars[0]!.document).map((s) => s.uid);
    expect(uids).toEqual(['a', 'b', 'new-1', 'new-2']);
    expect(checkInvariants(r.workspace, 'UTC')).toEqual([]);
  });

  it('brings the zones the events use, once', () => {
    const tz = [
      'UID:z',
      'SUMMARY:Call',
      'DTSTART;TZID=Custom/Zone:20261117T090000',
      'DTEND;TZID=Custom/Zone:20261117T100000',
    ];
    const source = doc(ics(ZONE_LINES, tz));
    const once = importEvents(ws(), context(), 'Home.ics', source).workspace;
    const children = once.calendars[0]!.document.children.filter((c) => c.kind === 'component');
    expect(children.map((c) => c.name)).toEqual(['VTIMEZONE', 'VEVENT', 'VEVENT']);
    const again = importEvents(once, context(), 'Home.ics', doc(ics(ZONE_LINES, tz)));
    expect(again.added).toBe(0);
    expect(again.workspace).toBe(once);
  });

  it('changes nothing when every event is already there', () => {
    const w = ws();
    const r = importEvents(w, context(), 'Home.ics', doc(ics([], event('a', 'Standup'))));
    expect(r).toEqual({ workspace: w, added: 0, skipped: 1 });
  });
});
