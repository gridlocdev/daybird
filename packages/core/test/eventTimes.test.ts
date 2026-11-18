import { describe, expect, it } from 'vitest';
import {
  allDayTimes,
  dayBounds,
  nextHalfHour,
  snapDown,
  timedTimes,
  whenOf,
  withWhen,
} from '../src/index.ts';

const ny = 'America/New_York';

describe('new event times', () => {
  it('snaps down to the quarter hour', () => {
    expect([snapDown(0), snapDown(14), snapDown(15), snapDown(59)]).toEqual([0, 0, 15, 45]);
  });

  it('makes timed events in the zone, UTC as Z, and at least a quarter hour long', () => {
    expect(timedTimes('2026-11-17', 540, 600, ny)).toEqual({
      start: { kind: 'date-time', dateTime: '2026-11-17T09:00:00', utc: false, tzid: ny },
      end: { kind: 'date-time', dateTime: '2026-11-17T10:00:00', utc: false, tzid: ny },
    });
    const utc = timedTimes('2026-11-17', 1410, 1410, 'UTC');
    expect(utc.start).toEqual({ kind: 'date-time', dateTime: '2026-11-17T23:30:00', utc: true, tzid: null });
    expect(utc.end).toEqual({ kind: 'date-time', dateTime: '2026-11-17T23:45:00', utc: true, tzid: null });
  });

  it('makes all-day events over the days in either order', () => {
    expect(allDayTimes('2026-11-19', '2026-11-17')).toEqual({
      start: { kind: 'date', date: '2026-11-17' },
      end: { kind: 'date', date: '2026-11-20' },
    });
  });

  it('starts ⌘N at the next half hour, rolling into tomorrow', () => {
    const day = dayBounds('2026-11-17', ny).start;
    expect(nextHalfHour(day + 9 * 3600, ny)).toEqual({ date: '2026-11-17', minute: 570 });
    expect(nextHalfHour(day + 9 * 3600 + 29 * 60, ny)).toEqual({ date: '2026-11-17', minute: 570 });
    expect(nextHalfHour(day + 23 * 3600 + 45 * 60, ny)).toEqual({ date: '2026-11-18', minute: 0 });
  });
});

describe('the popover’s when fields', () => {
  const t = timedTimes('2026-11-17', 540, 600, ny);

  it('reads all-day with the last day included', () => {
    const a = allDayTimes('2026-11-19', '2026-11-20');
    expect(whenOf(a.start, a.end)).toEqual({
      allDay: true,
      startDate: '2026-11-19',
      startMinute: 0,
      endDate: '2026-11-20',
      endMinute: 0,
    });
  });

  it('keeps the length when the start moves', () => {
    const w = withWhen(t.start, t.end, { startMinute: 13 * 60 }, ny, 60);
    expect(whenOf(w.start, w.end)).toMatchObject({ startMinute: 780, endMinute: 840, endDate: '2026-11-17' });
    const d = withWhen(t.start, t.end, { startDate: '2026-11-20' }, ny, 60);
    expect(whenOf(d.start, d.end)).toMatchObject({ startDate: '2026-11-20', endDate: '2026-11-20' });
  });

  it('keeps an end before the start a quarter hour after it', () => {
    const w = withWhen(t.start, t.end, { endMinute: 8 * 60 }, ny, 60);
    expect(whenOf(w.start, w.end)).toMatchObject({ startMinute: 540, endMinute: 555 });
  });

  it('turns all-day on and off', () => {
    const on = withWhen(t.start, t.end, { allDay: true }, ny, 60);
    expect(on).toEqual(allDayTimes('2026-11-17', '2026-11-17'));
    const off = withWhen(on.start, on.end, { allDay: false }, ny, 30);
    expect(whenOf(off.start, off.end)).toMatchObject({ allDay: false, startMinute: 540, endMinute: 570 });
    expect(off.start).toMatchObject({ tzid: ny });
  });

  it('moves an all-day event keeping its days', () => {
    const a = allDayTimes('2026-11-19', '2026-11-20');
    const moved = withWhen(a.start, a.end, { startDate: '2026-11-24' }, ny, 60);
    expect(moved).toEqual(allDayTimes('2026-11-24', '2026-11-25'));
  });
});
