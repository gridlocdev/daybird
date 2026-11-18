import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  diffDays,
  fromEpochDay,
  isPlainDate,
  isoWeek,
  parsePlainDate,
  startOfWeek,
  toEpochDay,
  todayIn,
  weekday,
} from '@daybird/core';

describe('plain dates', () => {
  it('rejects dates that do not exist', () => {
    expect(parsePlainDate('2026-02-29')).toBeNull();
    expect(parsePlainDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parsePlainDate('1900-02-29')).toBeNull();
    expect(parsePlainDate('2000-02-29')).not.toBeNull();
    expect(isPlainDate('2026-13-01')).toBe(false);
    expect(isPlainDate('2026-1-01')).toBe(false);
    expect(isPlainDate(20261117)).toBe(false);
  });

  it('counts days from 1970-01-01 both ways', () => {
    expect(toEpochDay('1970-01-01')).toBe(0);
    expect(toEpochDay('1969-12-31')).toBe(-1);
    expect(toEpochDay('2000-03-01')).toBe(11017);
    for (let d = toEpochDay('0001-01-01'); d <= toEpochDay('9999-12-31'); d += 7919)
      expect(toEpochDay(fromEpochDay(d))).toBe(d);
  });

  it('agrees with Date for every day of several years', () => {
    for (let d = toEpochDay('1999-01-01'); d < toEpochDay('2031-01-01'); d++) {
      expect(fromEpochDay(d)).toBe(new Date(d * 86_400_000).toISOString().slice(0, 10));
    }
  });

  it('adds days and months across ends of months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-17', -11)).toBe('2025-12-17');
    expect(addMonths('2026-11-17', 14)).toBe('2028-01-17');
    expect(diffDays('2026-11-17', '2026-11-10')).toBe(-7);
  });

  it('finds weekdays and week starts', () => {
    expect(weekday('2026-11-17')).toBe(2);
    expect(weekday('1969-12-28')).toBe(0);
    expect(startOfWeek('2026-11-17', 0)).toBe('2026-11-15');
    expect(startOfWeek('2026-11-17', 1)).toBe('2026-11-16');
    expect(startOfWeek('2026-11-15', 1)).toBe('2026-11-09');
    expect(startOfWeek('2026-11-14', 6)).toBe('2026-11-14');
  });

  it('numbers ISO weeks', () => {
    expect(isoWeek('2026-01-01')).toBe(1);
    expect(isoWeek('2027-01-01')).toBe(53);
    expect(isoWeek('2024-12-30')).toBe(1);
    expect(isoWeek('2026-11-17')).toBe(47);
  });

  it('reads today in a given zone', () => {
    const instant = Date.UTC(2026, 10, 17, 3, 0);
    expect(todayIn(instant, 'UTC')).toBe('2026-11-17');
    expect(todayIn(instant, 'America/Los_Angeles')).toBe('2026-11-16');
    expect(todayIn(instant, 'Pacific/Kiritimati')).toBe('2026-11-17');
  });
});
