import { describe, expect, it } from 'vitest';
import {
  hourLabel,
  monthGrid,
  nextCalendarColour,
  rangeTitle,
  stepAnchor,
  textOn,
  viewRange,
  PALETTE,
} from '@daybird/core';

describe('views', () => {
  it('covers the right dates for each view', () => {
    expect(viewRange('day', '2026-11-17', 0)).toEqual({ start: '2026-11-17', end: '2026-11-18' });
    expect(viewRange('week', '2026-11-17', 1)).toEqual({ start: '2026-11-16', end: '2026-11-23' });
    expect(viewRange('year', '2026-11-17', 0)).toEqual({ start: '2026-01-01', end: '2027-01-01' });
    expect(viewRange('agenda', '2026-11-17', 0)).toEqual({ start: '2026-11-17', end: '2027-01-16' });
  });

  it('draws five month rows when the month fits, else six', () => {
    // February 2026 starts on a Sunday: exactly four weeks, shown as five.
    expect(monthGrid('2026-02-10', 0)).toEqual({ start: '2026-02-01', end: '2026-03-08' });
    // November 2026 starts on a Sunday and has 30 days: five weeks.
    expect(monthGrid('2026-11-17', 0)).toEqual({ start: '2026-11-01', end: '2026-12-06' });
    // August 2026 starts on a Saturday: six weeks with Sunday starts.
    expect(monthGrid('2026-08-01', 0)).toEqual({ start: '2026-07-26', end: '2026-09-06' });
  });

  it('steps by the view unit', () => {
    expect(stepAnchor('day', '2026-11-17', 1)).toBe('2026-11-18');
    expect(stepAnchor('week', '2026-11-17', -1)).toBe('2026-11-10');
    expect(stepAnchor('agenda', '2026-11-17', 1)).toBe('2026-11-24');
    expect(stepAnchor('month', '2026-01-31', 1)).toBe('2026-02-28');
    expect(stepAnchor('year', '2028-02-29', 1)).toBe('2029-02-28');
  });

  it('titles the range', () => {
    expect(rangeTitle('month', '2026-11-17', 0, 'en-US')).toEqual({ main: 'November', year: '2026' });
    expect(rangeTitle('day', '2026-11-17', 0, 'en-US')).toEqual({
      main: 'Tuesday, November 17',
      year: '2026',
    });
    expect(rangeTitle('week', '2026-11-17', 1, 'en-US')).toEqual({ main: 'Nov 16 – 22', year: '2026' });
    expect(rangeTitle('week', '2026-12-30', 1, 'en-US')).toEqual({
      main: 'Dec 28 – Jan 3',
      year: '2026 – 2027',
    });
    expect(rangeTitle('year', '2026-11-17', 0, 'en-US')).toEqual({ main: '', year: '2026' });
  });
});

describe('hourLabel', () => {
  it('follows the locale, or the time-format setting', () => {
    expect(hourLabel(9, 'en-US')).toBe('9 AM');
    expect(hourLabel(0, 'en-US')).toBe('12 AM');
    expect(hourLabel(15, 'en-GB')).toBe('15:00');
    expect(hourLabel(9, 'de-DE')).toBe('09:00');
    expect(hourLabel(15, 'en-US', false)).toBe('15:00');
    expect(hourLabel(0, 'en-US', false)).toBe('00:00');
    expect(hourLabel(15, 'en-GB', true)).toMatch(/^3\s?pm$/i);
  });
});

describe('colours', () => {
  it('gives new calendars unused palette colours first', () => {
    expect(nextCalendarColour([])).toBe('#1f77d0');
    expect(nextCalendarColour(['#1F77D0'])).toBe('#e5484d');
    expect(nextCalendarColour(PALETTE.map((c) => c.hex))).toBe('#1f77d0');
  });

  it('picks readable text for a fill', () => {
    expect(textOn('#1f77d0')).toBe('#ffffff');
    expect(textOn('#e2a300')).toBe('#000000');
    expect(textOn('not a colour')).toBe('#ffffff');
  });
});
