import { describe, expect, it } from 'vitest';
import {
  inDisplayZone,
  inFrameOf,
  timeZoneIds,
  withZone,
  zoneIdOf,
  zoneName,
  type TimeValue,
} from '../src/index.ts';

const at = (dateTime: string, tzid: string | null, utc = false): TimeValue => ({
  kind: 'date-time',
  dateTime,
  utc,
  tzid,
});
const none = new Map();

describe('time zone frames', () => {
  it('shows a New York event at London’s clock time, and writes it back in New York', () => {
    const own = {
      start: at('2026-11-17T09:00:00', 'America/New_York'),
      end: at('2026-11-17T10:00:00', 'America/New_York'),
    };
    const shown = inDisplayZone(own, none, 'Europe/London');
    expect(shown).toEqual({
      start: at('2026-11-17T14:00:00', 'Europe/London'),
      end: at('2026-11-17T15:00:00', 'Europe/London'),
    });
    const moved = {
      start: at('2026-11-18T16:00:00', 'Europe/London'),
      end: at('2026-11-18T17:00:00', 'Europe/London'),
    };
    expect(inFrameOf(moved, own.start, none, 'Europe/London')).toEqual({
      start: at('2026-11-18T11:00:00', 'America/New_York'),
      end: at('2026-11-18T12:00:00', 'America/New_York'),
    });
  });

  it('keeps floating times at their clock time, and UTC as Z', () => {
    const floating = { start: at('2026-11-17T09:00:00', null), end: at('2026-11-17T10:00:00', null) };
    const shown = inDisplayZone(floating, none, 'Asia/Tokyo');
    expect(shown.start).toEqual(at('2026-11-17T09:00:00', 'Asia/Tokyo'));
    expect(inFrameOf(shown, floating.start, none, 'Asia/Tokyo')).toEqual(floating);
    expect(inDisplayZone(floating, none, 'UTC').start).toEqual(at('2026-11-17T09:00:00', null, true));
  });

  it('leaves all-day events alone', () => {
    const day = {
      start: { kind: 'date', date: '2026-11-17' } as const,
      end: { kind: 'date', date: '2026-11-18' } as const,
    };
    expect(inDisplayZone(day, none, 'Asia/Tokyo')).toBe(day);
  });

  it('changes the zone and keeps the clock time', () => {
    const own = {
      start: at('2026-11-17T09:00:00', 'America/New_York'),
      end: at('2026-11-17T10:00:00', 'America/New_York'),
    };
    expect(withZone(own, 'Asia/Tokyo').start).toEqual(at('2026-11-17T09:00:00', 'Asia/Tokyo'));
    expect(withZone(own, 'UTC').start).toEqual(at('2026-11-17T09:00:00', null, true));
    expect(withZone(own, null).start).toEqual(at('2026-11-17T09:00:00', null));
    expect(zoneIdOf(own.start)).toBe('America/New_York');
    expect(zoneIdOf(at('2026-11-17T09:00:00', null, true))).toBe('UTC');
  });

  it('names zones and lists them', () => {
    expect(zoneName('America/New_York')).toBe('New York');
    expect(zoneName('America/Indiana/Knox')).toBe('Indiana/Knox');
    expect(zoneName('UTC')).toBe('UTC');
    expect(timeZoneIds()).toContain('Europe/London');
    expect(timeZoneIds()).toContain('UTC');
  });
});
