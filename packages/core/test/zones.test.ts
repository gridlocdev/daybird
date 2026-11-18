import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FLOATING,
  UTC,
  addSeconds,
  componentNode,
  components,
  fileZones,
  formatDuration,
  formatOffset,
  fromLocalSeconds,
  ianaZone,
  isPlainDateTime,
  offsetAt,
  parseDuration,
  parseOffset,
  parseTimeText,
  property,
  readCalendar,
  readTimeList,
  readTimeProperty,
  readVTimezone,
  resolveTzid,
  timeOf,
  toInstant,
  toLocal,
  toLocalSeconds,
  transitionsIn,
  vtimezoneFor,
  withVTimezones,
  writeCalendar,
  type ComponentNode,
  type Zone,
} from '@daybird/core';

const LONDON = ianaZone('Europe/London');
const NEW_YORK = ianaZone('America/New_York');

function instant(local: string, zone: Zone, display = 'UTC'): string {
  return fromLocalSeconds(toInstant(toLocalSeconds(local), zone, display));
}

function calendar(name: string): ComponentNode {
  const r = readCalendar(readFileSync(new URL(`./fixtures/ical/${name}`, import.meta.url), 'utf8'));
  if (!r.ok) throw new Error(r.error.message);
  return r.calendar;
}

describe('date-times', () => {
  it('converts to and from local seconds', () => {
    expect(toLocalSeconds('1970-01-01T00:00:01')).toBe(1);
    expect(fromLocalSeconds(toLocalSeconds('2026-11-17T14:05:09'))).toBe('2026-11-17T14:05:09');
    expect(addSeconds('2026-12-31T23:59:59', 1)).toBe('2027-01-01T00:00:00');
    expect(timeOf('2026-11-17T14:05:09')).toEqual({ hour: 14, minute: 5, second: 9 });
    expect(isPlainDateTime('2026-02-30T00:00:00')).toBe(false);
    expect(isPlainDateTime('2026-02-28T24:00:00')).toBe(false);
  });
});

describe('time zones', () => {
  it('reads offsets from Intl', () => {
    expect(offsetAt(LONDON, toLocalSeconds('2026-01-15T12:00:00'), 'UTC')).toBe(0);
    expect(offsetAt(LONDON, toLocalSeconds('2026-07-15T12:00:00'), 'UTC')).toBe(3600);
    expect(offsetAt(NEW_YORK, toLocalSeconds('2026-07-15T12:00:00'), 'UTC')).toBe(-4 * 3600);
    expect(offsetAt(ianaZone('Asia/Kolkata'), 0, 'UTC')).toBe(5.5 * 3600);
    expect(offsetAt(UTC, 0, 'Europe/London')).toBe(0);
  });

  it('finds the exact moment of each change', () => {
    expect(transitionsIn(LONDON, 2026, 'UTC').map((t) => [fromLocalSeconds(t.at), t.from, t.to])).toEqual([
      ['2026-03-29T01:00:00', 0, 3600],
      ['2026-10-25T01:00:00', 3600, 0],
    ]);
    expect(transitionsIn(ianaZone('Asia/Tokyo'), 2026, 'UTC')).toEqual([]);
  });

  it('moves a time in a spring-forward gap forward by the gap', () => {
    expect(instant('2026-03-29T01:30:00', LONDON)).toBe('2026-03-29T01:30:00');
    expect(
      fromLocalSeconds(
        toLocal(toInstant(toLocalSeconds('2026-03-29T01:30:00'), LONDON, 'UTC'), LONDON, 'UTC'),
      ),
    ).toBe('2026-03-29T02:30:00');
    expect(instant('2026-03-08T02:30:00', NEW_YORK)).toBe('2026-03-08T07:30:00');
  });

  it('takes the earlier of a time that happens twice', () => {
    expect(instant('2026-10-25T01:30:00', LONDON)).toBe('2026-10-25T00:30:00');
    expect(instant('2026-11-01T01:30:00', NEW_YORK)).toBe('2026-11-01T05:30:00');
  });

  it('round-trips every hour of a year through local time', () => {
    const start = toLocalSeconds('2026-01-01T00:00:00');
    for (let utc = start; utc < start + 365 * 86_400; utc += 3600) {
      for (const zone of [LONDON, NEW_YORK, ianaZone('Australia/Lord_Howe')]) {
        expect(toInstant(toLocal(utc, zone, 'UTC'), zone, 'UTC') - utc).toBeLessThanOrEqual(0);
      }
    }
  });

  it('shows floating times at the same clock time in the display zone', () => {
    expect(instant('2026-07-01T09:00:00', FLOATING, 'Europe/London')).toBe('2026-07-01T08:00:00');
    expect(instant('2026-07-01T09:00:00', FLOATING, 'Asia/Tokyo')).toBe('2026-07-01T00:00:00');
    expect(instant('2026-07-01T09:00:00', UTC, 'Asia/Tokyo')).toBe('2026-07-01T09:00:00');
  });

  it('resolves IANA, Windows and prefixed TZIDs, then the file’s own zones', () => {
    expect(resolveTzid('Europe/London')).toEqual(LONDON);
    expect(resolveTzid('W. Europe Standard Time')).toEqual(ianaZone('Europe/Berlin'));
    expect(resolveTzid('Pacific Standard Time')).toEqual(ianaZone('America/Los_Angeles'));
    expect(resolveTzid('/mozilla.org/20050126_1/Europe/Paris')).toEqual(ianaZone('Europe/Paris'));
    expect(resolveTzid('Made Up Time')).toBeNull();
    const own: Zone = { kind: 'custom', id: 'Made Up Time', observances: [] };
    expect(resolveTzid('Made Up Time', new Map([['Made Up Time', own]]))).toBe(own);
  });

  it('formats and reads offsets', () => {
    expect(formatOffset(-5 * 3600)).toBe('-0500');
    expect(formatOffset(5.75 * 3600)).toBe('+0545');
    expect(formatOffset(-(3600 + 75))).toBe('-010115');
    expect(parseOffset('+0530')).toBe(5.5 * 3600);
    expect(parseOffset('-010115')).toBe(-(3600 + 75));
    expect(parseOffset('0530')).toBeNull();
  });
});

describe('VTIMEZONE', () => {
  it('uses a file’s own rules for a zone it defines', () => {
    const zones = fileZones(calendar('outlook.ics'));
    const zone = zones.get('W. Europe Standard Time');
    expect(zone?.kind).toBe('custom');
    if (!zone) return;
    expect(offsetAt(zone, toLocalSeconds('2026-01-15T12:00:00'), 'UTC')).toBe(3600);
    expect(offsetAt(zone, toLocalSeconds('2026-07-15T12:00:00'), 'UTC')).toBe(7200);
    expect(transitionsIn(zone, 2026, 'UTC').map((t) => fromLocalSeconds(t.at))).toEqual([
      '2026-03-29T01:00:00',
      '2026-10-25T01:00:00',
    ]);
  });

  it('agrees with Intl for the zones in the corpus', () => {
    for (const [file, tzid, iana] of [
      ['apple.ics', 'Europe/London', 'Europe/London'],
      ['google.ics', 'America/New_York', 'America/New_York'],
      ['fastmail.ics', 'Australia/Sydney', 'Australia/Sydney'],
    ] as const) {
      const zone = fileZones(calendar(file)).get(tzid);
      expect(zone, file).toBeDefined();
      if (!zone) continue;
      for (let day = 0; day < 365; day += 5) {
        const utc = toLocalSeconds('2026-01-01T12:00:00') + day * 86_400;
        expect(offsetAt(zone, utc, 'UTC'), `${file} day ${day}`).toBe(offsetAt(ianaZone(iana), utc, 'UTC'));
      }
    }
  });

  it.each([
    'Europe/London',
    'America/New_York',
    'Australia/Sydney',
    'Asia/Tokyo',
    'America/Sao_Paulo',
    'Asia/Kolkata',
  ])('writes a VTIMEZONE for %s that gives the same offsets as Intl', (id) => {
    const written = vtimezoneFor(id, 2026);
    expect(property(written, 'TZID')?.value).toBe(id);
    const zone = readVTimezone(written);
    expect(zone).not.toBeNull();
    if (!zone) return;
    for (let hour = 0; hour < 365 * 24; hour += 7) {
      const utc = toLocalSeconds('2026-01-01T00:00:00') + hour * 3600;
      expect(offsetAt(zone, utc, 'UTC')).toBe(offsetAt(ianaZone(id), utc, 'UTC'));
    }
  });

  it('writes London as two yearly rules', () => {
    const text = writeCalendar(componentNode('VCALENDAR', [vtimezoneFor('Europe/London', 2026)]));
    expect(text).toContain(
      'BEGIN:DAYLIGHT\r\nDTSTART:19700329T010000\r\nTZOFFSETFROM:+0000\r\nTZOFFSETTO:+0100\r\nRRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3\r\n',
    );
    expect(text).toContain(
      'BEGIN:STANDARD\r\nDTSTART:19701025T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0000\r\nRRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10\r\n',
    );
  });

  it('adds VTIMEZONEs only for zones the file doesn’t define, after the ones it does', () => {
    const google = calendar('google.ics');
    expect(withVTimezones(google, ['America/New_York'], 2026)).toBe(google);
    const added = withVTimezones(google, ['America/New_York', 'Europe/London'], 2026);
    expect(components(added, 'VTIMEZONE').map((c) => property(c, 'TZID')?.value)).toEqual([
      'America/New_York',
      'Europe/London',
    ]);
    const firstEvent = added.children.findIndex((c) => c.kind === 'component' && c.name === 'VEVENT');
    expect(
      added.children.findIndex(
        (c) => c.kind === 'component' && property(c, 'TZID')?.value === 'Europe/London',
      ),
    ).toBe(firstEvent - 1);
    const empty = withVTimezones(componentNode('VCALENDAR', [componentNode('VEVENT')]), ['Asia/Tokyo'], 2026);
    expect(empty.children.map((c) => (c.kind === 'component' ? c.name : ''))).toEqual([
      'VTIMEZONE',
      'VEVENT',
    ]);
  });
});

describe('values', () => {
  it('reads dates, date-times, UTC and zoned times', () => {
    expect(parseTimeText('20261117', null)).toEqual({ kind: 'date', date: '2026-11-17' });
    expect(parseTimeText('20261117T090000Z', 'Europe/London')).toEqual({
      kind: 'date-time',
      dateTime: '2026-11-17T09:00:00',
      utc: true,
      tzid: null,
    });
    expect(parseTimeText('20261117T090000', 'Europe/London')).toEqual({
      kind: 'date-time',
      dateTime: '2026-11-17T09:00:00',
      utc: false,
      tzid: 'Europe/London',
    });
    expect(parseTimeText('20261131', null)).toBeNull();
    expect(parseTimeText('20261117T250000', null)).toBeNull();
  });

  it('honours VALUE=DATE and TZID on a property, and reads lists and periods', () => {
    expect(
      readTimeProperty({ name: 'DTSTART', params: [{ name: 'VALUE', values: ['DATE'] }], value: '20261117' }),
    ).toEqual({ kind: 'date', date: '2026-11-17' });
    expect(
      readTimeList({
        name: 'EXDATE',
        params: [{ name: 'TZID', values: ['Europe/London'] }],
        value: '20261117T090000,20261124T090000',
      }),
    ).toHaveLength(2);
    expect(
      readTimeList({
        name: 'RDATE',
        params: [{ name: 'VALUE', values: ['PERIOD'] }],
        value: '20261117T090000Z/PT1H',
      }),
    ).toEqual([{ kind: 'date-time', dateTime: '2026-11-17T09:00:00', utc: true, tzid: null }]);
    expect(readTimeList({ name: 'EXDATE', params: [], value: '20261117T090000,nonsense' })).toBeNull();
  });

  it('reads and writes durations', () => {
    expect(parseDuration('P1W')).toEqual({ negative: false, weeks: 1, days: 0, seconds: 0 });
    expect(parseDuration('-PT15M')).toEqual({ negative: true, weeks: 0, days: 0, seconds: 900 });
    expect(parseDuration('P1DT2H3M4S')).toEqual({ negative: false, weeks: 0, days: 1, seconds: 7384 });
    expect(parseDuration('-P0DT1H0M0S')).toEqual({ negative: true, weeks: 0, days: 0, seconds: 3600 });
    expect(parseDuration('P')).toBeNull();
    expect(parseDuration('PT')).toBeNull();
    expect(parseDuration('1H')).toBeNull();
    for (const text of ['P1W', '-PT15M', 'P1DT2H3M4S', 'PT0S', 'P2D']) {
      const d = parseDuration(text);
      expect(d && formatDuration(d)).toBe(text);
    }
  });
});
