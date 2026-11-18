import { describe, expect, it } from 'vitest';
import {
  UTC,
  customDefaults,
  customOf,
  formatRule,
  ianaZone,
  ordinalOf,
  parseRule,
  presetOf,
  presetRule,
  ruleFromCustom,
  untilDate,
  untilOn,
  type RecurrenceRule,
  type RepeatClock,
  type TimeValue,
} from '../src/index.ts';

const parsed = (text: string): RecurrenceRule => {
  const r = parseRule(text);
  if (!r.ok) throw new Error(r.message);
  return r.rule;
};

const ny = (dateTime: string): TimeValue => ({
  kind: 'date-time',
  dateTime,
  utc: false,
  tzid: 'America/New_York',
});
/** Tuesday 17 November 2026, 09:00 in New York. */
const nyClock: RepeatClock = {
  start: ny('2026-11-17T09:00:00'),
  zone: ianaZone('America/New_York'),
  displayZone: 'UTC',
};
const floatingClock: RepeatClock = {
  start: { kind: 'date-time', dateTime: '2026-11-17T09:00:00', utc: false, tzid: null },
  zone: { kind: 'floating' },
  displayZone: 'UTC',
};
const allDayClock: RepeatClock = {
  start: { kind: 'date', date: '2026-11-17' },
  zone: UTC,
  displayZone: 'UTC',
};

describe('repeat presets', () => {
  it('reads each menu item back from its rule, and anything else as custom', () => {
    expect(presetOf(null)).toBe('never');
    expect(presetOf(parsed('FREQ=DAILY'))).toBe('daily');
    expect(presetOf(parsed('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'))).toBe('weekdays');
    expect(presetOf(parsed('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR'))).toBe('weekdays');
    expect(presetOf(parsed('FREQ=WEEKLY;COUNT=4'))).toBe('weekly');
    expect(presetOf(parsed('FREQ=WEEKLY;INTERVAL=2'))).toBe('biweekly');
    expect(presetOf(parsed('FREQ=MONTHLY;UNTIL=20270101'))).toBe('monthly');
    expect(presetOf(parsed('FREQ=YEARLY'))).toBe('yearly');
    expect(presetOf(parsed('FREQ=WEEKLY;BYDAY=MO,WE'))).toBe('custom');
    expect(presetOf(parsed('FREQ=MONTHLY;BYDAY=2TU'))).toBe('custom');
    expect(presetOf(parsed('FREQ=DAILY;INTERVAL=3'))).toBe('custom');
  });

  it('a menu item keeps the old rule’s end', () => {
    const old = parsed('FREQ=DAILY;COUNT=5;WKST=SU');
    expect(formatRule(presetRule('weekly', old)!)).toBe('FREQ=WEEKLY;COUNT=5;WKST=SU');
    expect(formatRule(presetRule('weekdays', null)!)).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(presetRule('never', old)).toBeNull();
  });
});

describe('the Custom repeat dialog', () => {
  it('reads a weekly rule on some days with an end date', () => {
    const c = customOf(parsed('FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T045959Z'), nyClock);
    expect(c).toMatchObject({
      freq: 'WEEKLY',
      interval: 1,
      weekdays: [1, 3],
      end: { kind: 'date', date: '2026-12-30' },
    });
  });

  it('reads monthly by day, by nth weekday and on the last day', () => {
    expect(customOf(parsed('FREQ=MONTHLY;BYMONTHDAY=3'), nyClock)?.monthly).toEqual({ kind: 'day', day: 3 });
    expect(customOf(parsed('FREQ=MONTHLY'), nyClock)?.monthly).toEqual({ kind: 'day', day: 17 });
    expect(customOf(parsed('FREQ=MONTHLY;BYDAY=-1FR'), nyClock)?.monthly).toEqual({
      kind: 'weekday',
      ordinal: -1,
      weekday: 5,
    });
    expect(customOf(parsed('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=6'), nyClock)).toMatchObject({
      monthly: { kind: 'last' },
      end: { kind: 'count', count: 6 },
    });
  });

  it('gives null for rules it can’t show, so they show in words', () => {
    for (const text of [
      'FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1',
      'FREQ=HOURLY',
      'FREQ=YEARLY;BYWEEKNO=20',
      'FREQ=WEEKLY;BYHOUR=9,17',
      'FREQ=MONTHLY;BYMONTHDAY=1,15',
      'FREQ=MONTHLY;BYDAY=5MO',
    ])
      expect(customOf(parsed(text), nyClock), text).toBeNull();
  });

  it('writes the days out, so a split series keeps them', () => {
    const base = customDefaults('2026-11-17');
    expect(formatRule(ruleFromCustom(base, nyClock, null))).toBe('FREQ=WEEKLY;BYDAY=TU');
    expect(formatRule(ruleFromCustom({ ...base, weekdays: [4, 2] }, nyClock, null))).toBe(
      'FREQ=WEEKLY;BYDAY=TU,TH',
    );
    expect(formatRule(ruleFromCustom({ ...base, freq: 'MONTHLY' }, nyClock, null))).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=17',
    );
    expect(
      formatRule(
        ruleFromCustom(
          { ...base, freq: 'MONTHLY', monthly: { kind: 'weekday', ordinal: 3, weekday: 2 } },
          nyClock,
          null,
        ),
      ),
    ).toBe('FREQ=MONTHLY;BYDAY=3TU');
    expect(formatRule(ruleFromCustom({ ...base, freq: 'YEARLY', months: [11, 5] }, nyClock, null))).toBe(
      'FREQ=YEARLY;BYMONTH=5,11',
    );
    expect(
      formatRule(ruleFromCustom({ ...base, interval: 3, end: { kind: 'count', count: 4 } }, nyClock, null)),
    ).toBe('FREQ=WEEKLY;COUNT=4;INTERVAL=3;BYDAY=TU');
  });

  it('round-trips every rule it can read', () => {
    for (const text of [
      'FREQ=DAILY;INTERVAL=2',
      'FREQ=WEEKLY;COUNT=10;BYDAY=MO,WE,FR',
      'FREQ=MONTHLY;BYDAY=-1FR',
      'FREQ=MONTHLY;BYMONTHDAY=-1',
      'FREQ=YEARLY;BYMONTH=1,7',
      'FREQ=YEARLY;BYDAY=4TH;BYMONTH=11',
    ]) {
      const c = customOf(parsed(text), nyClock)!;
      expect(formatRule(ruleFromCustom(c, nyClock, parsed(text))), text).toBe(text);
    }
  });
});

describe('the end of a repeat', () => {
  it('ends at the last second of the day on the event’s clock, in UTC when it has a zone', () => {
    expect(untilOn('2026-12-31', nyClock)).toEqual({
      kind: 'date-time',
      dateTime: '2027-01-01T04:59:59',
      utc: true,
    });
    expect(untilOn('2026-12-31', floatingClock)).toEqual({
      kind: 'date-time',
      dateTime: '2026-12-31T23:59:59',
      utc: false,
    });
    expect(untilOn('2026-12-31', allDayClock)).toEqual({ kind: 'date', date: '2026-12-31' });
  });

  it('reads the day back on the event’s clock', () => {
    expect(untilDate(untilOn('2026-12-31', nyClock), nyClock)).toBe('2026-12-31');
    expect(untilDate({ kind: 'date', date: '2027-03-01' }, nyClock)).toBe('2027-03-01');
  });

  it('names the nth weekday of a date, with a fifth as last', () => {
    expect(ordinalOf('2026-11-17')).toBe(3);
    expect(ordinalOf('2026-11-30')).toBe(-1);
    expect(ordinalOf('2026-11-01')).toBe(1);
  });
});
