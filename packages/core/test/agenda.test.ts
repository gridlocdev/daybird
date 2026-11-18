import { describe, expect, it } from 'vitest';
import { agendaDays, busyLevel, dayBounds, type MonthItem } from '../src/index.ts';

const zone = 'America/New_York';
interface Item extends MonthItem {
  readonly name: string;
}
const timed = (name: string, day: string, hour: number, hours = 1): Item => {
  const start = dayBounds(day, zone).start + hour * 3600;
  return { name, start, end: start + hours * 3600, allDay: false, startDate: null, endDate: null };
};

describe('the agenda', () => {
  it('groups by day, skips empty days, puts all-day first and repeats a long event on each day', () => {
    const days = agendaDays<Item>(
      [
        timed('late', '2026-11-17', 15),
        timed('early', '2026-11-17', 9),
        timed('overnight', '2026-11-19', 22, 4),
        { name: 'trip', start: 0, end: 0, allDay: true, startDate: '2026-11-17', endDate: '2026-11-19' },
        timed('before', '2026-11-10', 9),
      ],
      { start: '2026-11-17', end: '2026-12-17' },
      zone,
    );
    expect(days.map((d) => [d.date, d.items.map((i) => i.name)])).toEqual([
      ['2026-11-17', ['trip', 'early', 'late']],
      ['2026-11-18', ['trip']],
      ['2026-11-19', ['overnight']],
      ['2026-11-20', ['overnight']],
    ]);
  });

  it('tints a Year day in four steps', () => {
    expect([0, 1, 2, 3, 5, 6, 40].map(busyLevel)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
});
