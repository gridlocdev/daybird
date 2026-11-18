import { describe, expect, it } from 'vitest';
import {
  allDayTimes,
  eventAsText,
  movedTimes,
  onDate,
  readCalendar,
  shiftedTimes,
  timedTimes,
  withEndAt,
  withStartAt,
  type TimeValue,
} from '../src/index.ts';

const ny = (dateTime: string): TimeValue => ({
  kind: 'date-time',
  dateTime,
  utc: false,
  tzid: 'America/New_York',
});

describe('moving events', () => {
  it('a timed event dropped at a new time keeps its length and its own zone', () => {
    const t = { start: ny('2026-11-17T09:00:00'), end: ny('2026-11-17T10:30:00') };
    expect(movedTimes(t, { kind: 'time', date: '2026-11-19', minute: 14 * 60 }, 'UTC', 60)).toEqual({
      start: ny('2026-11-19T14:00:00'),
      end: ny('2026-11-19T15:30:00'),
    });
  });

  it('an all-day event dropped on the grid takes the default length, and back keeps one day', () => {
    const t = allDayTimes('2026-11-17', '2026-11-18');
    expect(movedTimes(t, { kind: 'time', date: '2026-11-20', minute: 600 }, 'UTC', 30)).toEqual(
      timedTimes('2026-11-20', 600, 630, 'UTC'),
    );
    expect(movedTimes(t, { kind: 'day', date: '2026-11-20' }, 'UTC', 30)).toEqual(
      allDayTimes('2026-11-20', '2026-11-21'),
    );
    const timed = timedTimes('2026-11-17', 600, 660, 'UTC');
    expect(movedTimes(timed, { kind: 'day', date: '2026-11-19' }, 'UTC', 30)).toEqual(
      allDayTimes('2026-11-19', '2026-11-19'),
    );
  });

  it('shifts by days and minutes, and all-day events by days only', () => {
    const t = timedTimes('2026-11-17', 23 * 60 + 45, 24 * 60 + 15, 'UTC');
    expect(shiftedTimes(t, { minutes: 15 })).toEqual(timedTimes('2026-11-18', 0, 30, 'UTC'));
    expect(shiftedTimes(allDayTimes('2026-11-17', '2026-11-17'), { days: 7, minutes: 15 })).toEqual(
      allDayTimes('2026-11-24', '2026-11-24'),
    );
  });

  it('resizing keeps at least 15 minutes', () => {
    const t = timedTimes('2026-11-17', 600, 660, 'UTC');
    expect(withEndAt(t, '2026-11-17', 720, 'UTC')).toEqual(timedTimes('2026-11-17', 600, 720, 'UTC'));
    expect(withEndAt(t, '2026-11-17', 540, 'UTC')).toEqual(timedTimes('2026-11-17', 600, 615, 'UTC'));
    expect(withStartAt(t, '2026-11-17', 540)).toEqual(timedTimes('2026-11-17', 540, 660, 'UTC'));
    expect(withStartAt(t, '2026-11-17', 700)).toEqual(timedTimes('2026-11-17', 645, 660, 'UTC'));
  });

  it('a copy lands on another day at the same clock time', () => {
    const t = { start: ny('2026-11-17T09:00:00'), end: ny('2026-11-17T10:00:00') };
    expect(onDate(t, '2026-11-20')).toEqual({
      start: ny('2026-11-20T09:00:00'),
      end: ny('2026-11-20T10:00:00'),
    });
  });

  it('writes one event as a calendar file other apps can read, with its zone', () => {
    const text = eventAsText(
      { title: 'Lunch', start: ny('2026-11-17T12:00:00'), end: ny('2026-11-17T13:00:00') },
      'copy@example.com',
      1_795_000_000,
    );
    expect(text).toContain('BEGIN:VTIMEZONE');
    expect(text).toContain('SUMMARY:Lunch');
    expect(text).toContain('DTSTART;TZID=America/New_York:20261117T120000');
    expect(readCalendar(text).ok).toBe(true);
  });
});
