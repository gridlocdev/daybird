import { describe, expect, it } from 'vitest';
import { loadCalendar, occurrenceDetails } from '../src/index.ts';

const ics = (...lines: string[]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//Test//EN',
    'BEGIN:VEVENT',
    ...lines,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

const zone = 'America/New_York';

describe('the details of an occurrence', () => {
  it('gives a repeating occurrence its own times in the event’s zone, and the repeat in words', () => {
    const calendar = loadCalendar(
      'Work.ics',
      ics(
        'UID:standup',
        'DTSTAMP:20261101T000000Z',
        'DTSTART;TZID=Europe/London:20261102T090000',
        'DTEND;TZID=Europe/London:20261102T093000',
        'RRULE:FREQ=WEEKLY',
        'SUMMARY:Standup',
      ),
      () => 'x',
      [],
    ).calendar;
    const key = Date.UTC(2026, 10, 16, 9) / 1000;
    const d = occurrenceDetails(calendar, 'standup', key, zone);
    expect(d?.start).toEqual({
      kind: 'date-time',
      dateTime: '2026-11-16T09:00:00',
      utc: false,
      tzid: 'Europe/London',
    });
    expect(d?.end).toMatchObject({ dateTime: '2026-11-16T09:30:00' });
    expect(d?.repeat).toBe('Every week');
    expect(d?.occurrence.title).toBe('Standup');
  });

  it('gives an all-day event its dates and no repeat', () => {
    const calendar = loadCalendar(
      'Home.ics',
      ics('UID:trip', 'DTSTAMP:20261101T000000Z', 'DTSTART;VALUE=DATE:20261119', 'DTEND;VALUE=DATE:20261121'),
      () => 'x',
      [],
    ).calendar;
    const d = occurrenceDetails(calendar, 'trip', null, zone);
    expect(d?.start).toEqual({ kind: 'date', date: '2026-11-19' });
    expect(d?.end).toEqual({ kind: 'date', date: '2026-11-21' });
    expect(d?.repeat).toBeNull();
    expect(occurrenceDetails(calendar, 'gone', null, zone)).toBeNull();
  });
});
