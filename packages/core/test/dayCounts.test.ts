import { describe, expect, it } from 'vitest';
import { countsByDay, dayBounds, type MonthItem } from '../src/index.ts';

const zone = 'Europe/Berlin';
const timed = (day: string, hour: number, hours = 1): MonthItem => {
  const start = dayBounds(day, zone).start + hour * 3600;
  return { start, end: start + hours * 3600, allDay: false, startDate: null, endDate: null };
};

describe('counts by day', () => {
  it('counts each day an event touches, inside the range only', () => {
    const counts = countsByDay(
      [
        timed('2026-11-17', 9),
        timed('2026-11-17', 22, 4), // into the 18th
        { start: 0, end: 0, allDay: true, startDate: '2026-11-29', endDate: '2026-12-03' },
        timed('2026-12-10', 9),
      ],
      { start: '2026-11-15', end: '2026-12-01' },
      zone,
    );
    expect(Object.fromEntries(counts)).toEqual({
      '2026-11-17': 2,
      '2026-11-18': 1,
      '2026-11-29': 1,
      '2026-11-30': 1,
    });
  });
});
