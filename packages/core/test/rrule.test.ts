import { describe, expect, it } from 'vitest';
import {
  describeRule,
  expandRule,
  formatRule,
  expandSet,
  fromLocalSeconds,
  isInSet,
  ianaZone,
  parseRule,
  toInstant,
  toLocal,
  toLocalSeconds,
  type RecurrenceRule,
} from '@daybird/core';

const NEW_YORK = ianaZone('America/New_York');

function parsed(text: string): RecurrenceRule {
  const result = parseRule(text);
  if (!result.ok) throw new Error(result.message);
  return result.rule;
}

/**
 * Expands `text` from `start` (a wall-clock time in New York, as in RFC 5545's examples) up to `to`, with a
 * UTC UNTIL converted into New York time the way the engine does.
 */
function expand(text: string, start: string, to = '2010-01-01T00:00:00', zone = NEW_YORK): string[] {
  const r = parsed(text);
  const untilLocal =
    r.until?.kind === 'date-time' && r.until.utc
      ? toLocal(toLocalSeconds(r.until.dateTime), zone, 'UTC')
      : undefined;
  const { starts } = expandRule(r, toLocalSeconds(start), {
    from: toLocalSeconds(start),
    to: toLocalSeconds(to),
    ...(untilLocal === undefined ? {} : { untilLocal }),
  });
  return starts.map(fromLocalSeconds);
}

/** Dates at 09:00, from `YYYY-MM-DD` strings. */
function at9(...dates: string[]): string[] {
  return dates.map((d) => `${d}T09:00:00`);
}

function days(year: number, month: number, ...list: number[]): string[] {
  return list.map((d) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
}

describe('RFC 5545 §3.8.5.3 examples', () => {
  const START = '1997-09-02T09:00:00';

  it('daily for 10 occurrences', () => {
    expect(expand('FREQ=DAILY;COUNT=10', START)).toEqual(
      at9(...days(1997, 9, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)),
    );
  });

  it('daily until December 24, 1997', () => {
    const got = expand('FREQ=DAILY;UNTIL=19971224T000000Z', START);
    expect(got).toHaveLength(113);
    expect(got.at(-1)).toBe('1997-12-23T09:00:00');
  });

  it('every other day', () => {
    expect(expand('FREQ=DAILY;INTERVAL=2', START, '1997-09-10T00:00:00')).toEqual(
      at9(...days(1997, 9, 2, 4, 6, 8)),
    );
  });

  it('every 10 days, 5 occurrences', () => {
    expect(expand('FREQ=DAILY;INTERVAL=10;COUNT=5', START)).toEqual(
      at9(...days(1997, 9, 2, 12, 22), ...days(1997, 10, 2, 12)),
    );
  });

  it('every day in January, for 3 years (yearly and daily forms)', () => {
    const yearly = expand(
      'FREQ=YEARLY;UNTIL=20000131T140000Z;BYMONTH=1;BYDAY=SU,MO,TU,WE,TH,FR,SA',
      '1998-01-01T09:00:00',
    );
    const daily = expand('FREQ=DAILY;UNTIL=20000131T140000Z;BYMONTH=1', '1998-01-01T09:00:00');
    expect(yearly).toHaveLength(93);
    expect(daily).toEqual(yearly);
    expect(yearly.at(-1)).toBe('2000-01-31T09:00:00');
  });

  it('weekly for 10 occurrences', () => {
    expect(expand('FREQ=WEEKLY;COUNT=10', START)).toEqual(
      at9(...days(1997, 9, 2, 9, 16, 23, 30), ...days(1997, 10, 7, 14, 21, 28), ...days(1997, 11, 4)),
    );
  });

  it('weekly until December 24, 1997', () => {
    const got = expand('FREQ=WEEKLY;UNTIL=19971224T000000Z', START);
    expect(got).toHaveLength(17);
    expect(got.at(-1)).toBe('1997-12-23T09:00:00');
  });

  it('every other week', () => {
    expect(expand('FREQ=WEEKLY;INTERVAL=2;WKST=SU', START, '1998-02-01T00:00:00')).toEqual(
      at9(
        ...days(1997, 9, 2, 16, 30),
        ...days(1997, 10, 14, 28),
        ...days(1997, 11, 11, 25),
        ...days(1997, 12, 9, 23),
        ...days(1998, 1, 6, 20),
      ),
    );
  });

  it('weekly on Tuesday and Thursday for five weeks (UNTIL and COUNT forms)', () => {
    const expected = at9(...days(1997, 9, 2, 4, 9, 11, 16, 18, 23, 25, 30), ...days(1997, 10, 2));
    expect(expand('FREQ=WEEKLY;UNTIL=19971007T000000Z;WKST=SU;BYDAY=TU,TH', START)).toEqual(expected);
    expect(expand('FREQ=WEEKLY;COUNT=10;WKST=SU;BYDAY=TU,TH', START)).toEqual(expected);
  });

  it('every other week on Monday, Wednesday and Friday until December 24, 1997', () => {
    expect(
      expand('FREQ=WEEKLY;INTERVAL=2;UNTIL=19971224T000000Z;WKST=SU;BYDAY=MO,WE,FR', '1997-09-01T09:00:00'),
    ).toEqual(
      at9(
        ...days(1997, 9, 1, 3, 5, 15, 17, 19, 29),
        ...days(1997, 10, 1, 3, 13, 15, 17, 27, 29, 31),
        ...days(1997, 11, 10, 12, 14, 24, 26, 28),
        ...days(1997, 12, 8, 10, 12, 22),
      ),
    );
  });

  it('every other week on Tuesday and Thursday, for 8 occurrences', () => {
    expect(expand('FREQ=WEEKLY;INTERVAL=2;COUNT=8;WKST=SU;BYDAY=TU,TH', START)).toEqual(
      at9(...days(1997, 9, 2, 4, 16, 18, 30), ...days(1997, 10, 2, 14, 16)),
    );
  });

  it('monthly on the first Friday for 10 occurrences, and until December 24', () => {
    expect(expand('FREQ=MONTHLY;COUNT=10;BYDAY=1FR', '1997-09-05T09:00:00')).toEqual(
      at9(
        '1997-09-05',
        '1997-10-03',
        '1997-11-07',
        '1997-12-05',
        '1998-01-02',
        '1998-02-06',
        '1998-03-06',
        '1998-04-03',
        '1998-05-01',
        '1998-06-05',
      ),
    );
    expect(expand('FREQ=MONTHLY;UNTIL=19971224T000000Z;BYDAY=1FR', '1997-09-05T09:00:00')).toEqual(
      at9('1997-09-05', '1997-10-03', '1997-11-07', '1997-12-05'),
    );
  });

  it('every other month on the first and last Sunday, for 10 occurrences', () => {
    expect(expand('FREQ=MONTHLY;INTERVAL=2;COUNT=10;BYDAY=1SU,-1SU', '1997-09-07T09:00:00')).toEqual(
      at9(
        '1997-09-07',
        '1997-09-28',
        '1997-11-02',
        '1997-11-30',
        '1998-01-04',
        '1998-01-25',
        '1998-03-01',
        '1998-03-29',
        '1998-05-03',
        '1998-05-31',
      ),
    );
  });

  it('monthly on the second-to-last Monday for 6 months', () => {
    expect(expand('FREQ=MONTHLY;COUNT=6;BYDAY=-2MO', '1997-09-22T09:00:00')).toEqual(
      at9('1997-09-22', '1997-10-20', '1997-11-17', '1997-12-22', '1998-01-19', '1998-02-16'),
    );
  });

  it('monthly on the third-to-last day', () => {
    expect(expand('FREQ=MONTHLY;BYMONTHDAY=-3', '1997-09-28T09:00:00', '1998-03-01T00:00:00')).toEqual(
      at9('1997-09-28', '1997-10-29', '1997-11-28', '1997-12-29', '1998-01-29', '1998-02-26'),
    );
  });

  it('monthly on the 2nd and 15th for 10 occurrences', () => {
    expect(expand('FREQ=MONTHLY;COUNT=10;BYMONTHDAY=2,15', START)).toEqual(
      at9(
        '1997-09-02',
        '1997-09-15',
        '1997-10-02',
        '1997-10-15',
        '1997-11-02',
        '1997-11-15',
        '1997-12-02',
        '1997-12-15',
        '1998-01-02',
        '1998-01-15',
      ),
    );
  });

  it('monthly on the first and last day for 10 occurrences', () => {
    expect(expand('FREQ=MONTHLY;COUNT=10;BYMONTHDAY=1,-1', '1997-09-30T09:00:00')).toEqual(
      at9(
        '1997-09-30',
        '1997-10-01',
        '1997-10-31',
        '1997-11-01',
        '1997-11-30',
        '1997-12-01',
        '1997-12-31',
        '1998-01-01',
        '1998-01-31',
        '1998-02-01',
      ),
    );
  });

  it('every 18 months on the 10th to 15th, for 10 occurrences', () => {
    expect(
      expand('FREQ=MONTHLY;INTERVAL=18;COUNT=10;BYMONTHDAY=10,11,12,13,14,15', '1997-09-10T09:00:00'),
    ).toEqual(at9(...days(1997, 9, 10, 11, 12, 13, 14, 15), ...days(1999, 3, 10, 11, 12, 13)));
  });

  it('every Tuesday, every other month', () => {
    expect(expand('FREQ=MONTHLY;INTERVAL=2;BYDAY=TU', START, '1998-03-04T00:00:00')).toEqual(
      at9(
        ...days(1997, 9, 2, 9, 16, 23, 30),
        ...days(1997, 11, 4, 11, 18, 25),
        ...days(1998, 1, 6, 13, 20, 27),
        ...days(1998, 3, 3),
      ),
    );
  });

  it('yearly in June and July for 10 occurrences', () => {
    expect(expand('FREQ=YEARLY;COUNT=10;BYMONTH=6,7', '1997-06-10T09:00:00')).toEqual(
      at9(...[1997, 1998, 1999, 2000, 2001].flatMap((y) => [`${y}-06-10`, `${y}-07-10`])),
    );
  });

  it('every other year on January, February and March for 10 occurrences', () => {
    expect(expand('FREQ=YEARLY;INTERVAL=2;COUNT=10;BYMONTH=1,2,3', '1997-03-10T09:00:00')).toEqual(
      at9(
        '1997-03-10',
        '1999-01-10',
        '1999-02-10',
        '1999-03-10',
        '2001-01-10',
        '2001-02-10',
        '2001-03-10',
        '2003-01-10',
        '2003-02-10',
        '2003-03-10',
      ),
    );
  });

  it('every third year on the 1st, 100th and 200th day for 10 occurrences', () => {
    expect(expand('FREQ=YEARLY;INTERVAL=3;COUNT=10;BYYEARDAY=1,100,200', '1997-01-01T09:00:00')).toEqual(
      at9(
        '1997-01-01',
        '1997-04-10',
        '1997-07-19',
        '2000-01-01',
        '2000-04-09',
        '2000-07-18',
        '2003-01-01',
        '2003-04-10',
        '2003-07-19',
        '2006-01-01',
      ),
    );
  });

  it('every 20th Monday of the year', () => {
    expect(expand('FREQ=YEARLY;BYDAY=20MO', '1997-05-19T09:00:00', '2000-01-01T00:00:00')).toEqual(
      at9('1997-05-19', '1998-05-18', '1999-05-17'),
    );
  });

  it('Monday of week number 20', () => {
    expect(expand('FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO', '1997-05-12T09:00:00', '2000-01-01T00:00:00')).toEqual(
      at9('1997-05-12', '1998-05-11', '1999-05-17'),
    );
  });

  it('every Thursday in March', () => {
    expect(expand('FREQ=YEARLY;BYMONTH=3;BYDAY=TH', '1997-03-13T09:00:00', '2000-01-01T00:00:00')).toEqual(
      at9(...days(1997, 3, 13, 20, 27), ...days(1998, 3, 5, 12, 19, 26), ...days(1999, 3, 4, 11, 18, 25)),
    );
  });

  it('every Thursday, but only during June, July and August', () => {
    expect(
      expand('FREQ=YEARLY;BYDAY=TH;BYMONTH=6,7,8', '1997-06-05T09:00:00', '1998-01-01T00:00:00'),
    ).toEqual(
      at9(
        ...days(1997, 6, 5, 12, 19, 26),
        ...days(1997, 7, 3, 10, 17, 24, 31),
        ...days(1997, 8, 7, 14, 21, 28),
      ),
    );
  });

  it('every Friday the 13th (DTSTART left out by EXDATE)', () => {
    expect(expand('FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13', START, '2001-01-01T00:00:00').slice(1)).toEqual(
      at9('1998-02-13', '1998-03-13', '1998-11-13', '1999-08-13', '2000-10-13'),
    );
  });

  it('the first Saturday that follows the first Sunday of the month', () => {
    expect(
      expand(
        'FREQ=MONTHLY;BYDAY=SA;BYMONTHDAY=7,8,9,10,11,12,13',
        '1997-09-13T09:00:00',
        '1998-06-14T00:00:00',
      ),
    ).toEqual(
      at9(
        '1997-09-13',
        '1997-10-11',
        '1997-11-08',
        '1997-12-13',
        '1998-01-10',
        '1998-02-07',
        '1998-03-07',
        '1998-04-11',
        '1998-05-09',
        '1998-06-13',
      ),
    );
  });

  it('US presidential election day, every 4 years', () => {
    expect(
      expand(
        'FREQ=YEARLY;INTERVAL=4;BYMONTH=11;BYDAY=TU;BYMONTHDAY=2,3,4,5,6,7,8',
        '1996-11-05T09:00:00',
        '2005-01-01T00:00:00',
      ),
    ).toEqual(at9('1996-11-05', '2000-11-07', '2004-11-02'));
  });

  it('the third instance of Tuesday, Wednesday or Thursday for the next 3 months', () => {
    expect(expand('FREQ=MONTHLY;COUNT=3;BYDAY=TU,WE,TH;BYSETPOS=3', '1997-09-04T09:00:00')).toEqual(
      at9('1997-09-04', '1997-10-07', '1997-11-06'),
    );
  });

  it('the second-to-last weekday of the month', () => {
    expect(
      expand('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-2', '1997-09-29T09:00:00', '1998-04-01T00:00:00'),
    ).toEqual(
      at9('1997-09-29', '1997-10-30', '1997-11-27', '1997-12-30', '1998-01-29', '1998-02-26', '1998-03-30'),
    );
  });

  it('every 3 hours from 9:00 to 17:00 on one day (UNTIL read on the event’s clock)', () => {
    expect(expand('FREQ=HOURLY;INTERVAL=3;UNTIL=19970902T170000', START)).toEqual([
      '1997-09-02T09:00:00',
      '1997-09-02T12:00:00',
      '1997-09-02T15:00:00',
    ]);
  });

  it('every 15 minutes for 6 occurrences, and every 90 minutes for 4', () => {
    expect(expand('FREQ=MINUTELY;INTERVAL=15;COUNT=6', START).map((t) => t.slice(11, 16))).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
      '10:15',
    ]);
    expect(expand('FREQ=MINUTELY;INTERVAL=90;COUNT=4', START).map((t) => t.slice(11, 16))).toEqual([
      '09:00',
      '10:30',
      '12:00',
      '13:30',
    ]);
  });

  it('every 20 minutes from 9:00 to 16:40 every day (daily and minutely forms)', () => {
    const daily = expand(
      'FREQ=DAILY;BYHOUR=9,10,11,12,13,14,15,16;BYMINUTE=0,20,40',
      START,
      '1997-09-04T00:00:00',
    );
    const minutely = expand(
      'FREQ=MINUTELY;INTERVAL=20;BYHOUR=9,10,11,12,13,14,15,16',
      START,
      '1997-09-04T00:00:00',
    );
    expect(daily).toHaveLength(48);
    expect(daily.slice(0, 3)).toEqual(['1997-09-02T09:00:00', '1997-09-02T09:20:00', '1997-09-02T09:40:00']);
    expect(daily[23]).toBe('1997-09-02T16:40:00');
    expect(daily[24]).toBe('1997-09-03T09:00:00');
    expect(minutely).toEqual(daily);
  });

  it('WKST changes which days fall in an every-other week', () => {
    expect(expand('FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO', '1997-08-05T09:00:00')).toEqual(
      at9('1997-08-05', '1997-08-10', '1997-08-19', '1997-08-24'),
    );
    expect(expand('FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU', '1997-08-05T09:00:00')).toEqual(
      at9('1997-08-05', '1997-08-17', '1997-08-19', '1997-08-31'),
    );
  });

  it('skips invalid dates rather than clamping them', () => {
    expect(expand('FREQ=MONTHLY;BYMONTHDAY=15,30;COUNT=5', '2007-01-15T09:00:00')).toEqual(
      at9('2007-01-15', '2007-01-30', '2007-02-15', '2007-03-15', '2007-03-30'),
    );
  });
});

describe('expansion', () => {
  it('repeats February 29 only in leap years', () => {
    expect(expand('FREQ=YEARLY', '2024-02-29T09:00:00', '2034-01-01T00:00:00')).toEqual(
      at9('2024-02-29', '2028-02-29', '2032-02-29'),
    );
    expect(expand('FREQ=MONTHLY;BYMONTHDAY=31', '2026-01-31T09:00:00', '2026-09-01T00:00:00')).toEqual(
      at9('2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31'),
    );
  });

  it('keeps a weekly 9:00 at 9:00 across daylight-saving changes', () => {
    const starts = expand('FREQ=WEEKLY', '2026-03-02T09:00:00', '2026-03-17T00:00:00');
    expect(starts).toEqual(at9('2026-03-02', '2026-03-09', '2026-03-16'));
    const instants = starts.map((s) => fromLocalSeconds(toInstant(toLocalSeconds(s), NEW_YORK, 'UTC')));
    expect(instants).toEqual(['2026-03-02T14:00:00', '2026-03-09T13:00:00', '2026-03-16T13:00:00']);
  });

  it('expands only the range asked for, and still counts from the start', () => {
    const r = parsed('FREQ=DAILY;COUNT=10');
    const { starts } = expandRule(r, toLocalSeconds('2026-01-01T09:00:00'), {
      from: toLocalSeconds('2026-01-08T00:00:00'),
      to: toLocalSeconds('2026-02-01T00:00:00'),
    });
    expect(starts.map(fromLocalSeconds)).toEqual(at9('2026-01-08', '2026-01-09', '2026-01-10'));
  });

  it('jumps ahead to a far range without walking every period', () => {
    const r = parsed('FREQ=DAILY');
    const { starts, capped } = expandRule(r, toLocalSeconds('1900-01-01T09:00:00'), {
      from: toLocalSeconds('2026-11-17T00:00:00'),
      to: toLocalSeconds('2026-11-19T00:00:00'),
      cap: 100,
    });
    expect(capped).toBe(false);
    expect(starts.map(fromLocalSeconds)).toEqual(at9('2026-11-17', '2026-11-18'));
  });

  it('stops at the cap and says so', () => {
    const r = parsed('FREQ=SECONDLY');
    const result = expandRule(r, toLocalSeconds('2026-11-17T00:00:00'), {
      from: toLocalSeconds('2026-11-17T00:00:00'),
      to: toLocalSeconds('2026-11-18T00:00:00'),
    });
    expect(result.capped).toBe(true);
    expect(result.starts.length).toBeLessThanOrEqual(50_000);
    expect(result.starts.length).toBeGreaterThan(20_000);
  });

  it('ends when a rule can never match again', () => {
    expect(
      expand('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30', '2026-01-01T09:00:00', '2100-01-01T00:00:00'),
    ).toEqual(['2026-01-01T09:00:00']);
  });
});

describe('reading and writing rules', () => {
  it('reads every part and writes them in a fixed order', () => {
    const r = parsed('byday=-1fr,MO;freq=monthly;wkst=su;interval=2;count=4;X-NAME=keep');
    expect(r).toMatchObject({ freq: 'MONTHLY', interval: 2, count: 4, wkst: 0 });
    expect(r.byDay).toEqual([
      { weekday: 5, ordinal: -1 },
      { weekday: 1, ordinal: 0 },
    ]);
    expect(formatRule(r)).toBe('FREQ=MONTHLY;COUNT=4;INTERVAL=2;BYDAY=-1FR,MO;WKST=SU;X-NAME=keep');
    expect(formatRule(parsed('FREQ=WEEKLY;UNTIL=20261231T235959Z;BYDAY=TU'))).toBe(
      'FREQ=WEEKLY;UNTIL=20261231T235959Z;BYDAY=TU',
    );
  });

  it.each([
    ['', 'The rule has no FREQ.'],
    ['FREQ=FORTNIGHTLY', '"FORTNIGHTLY" isn\'t a frequency.'],
    ['FREQ=DAILY;COUNT=0', 'COUNT must be a whole number from 1.'],
    ['FREQ=DAILY;COUNT=2;UNTIL=20260101', 'A rule can have COUNT or UNTIL, not both.'],
    ['FREQ=DAILY;BYMONTH=13', 'BYMONTH has a value out of range.'],
    ['FREQ=DAILY;BYMONTHDAY=0', 'BYMONTHDAY has a value out of range.'],
    ['FREQ=DAILY;BYDAY=XX', '"XX" isn\'t a weekday.'],
    ['FREQ=DAILY;UNTIL=2026', '"2026" isn\'t a date or date-time.'],
    ['FREQ=DAILY;INTERVAL', '"INTERVAL" has no value.'],
  ])('refuses %j', (text, message) => {
    expect(parseRule(text)).toEqual({ ok: false, message });
  });
});

describe('rules in words', () => {
  it.each([
    ['FREQ=DAILY', 'Every day'],
    ['FREQ=DAILY;INTERVAL=3', 'Every 3 days'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday'],
    ['FREQ=WEEKLY', 'Every week'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', 'Every 2 weeks on Monday and Wednesday'],
    ['FREQ=MONTHLY', 'Every month on day 17'],
    ['FREQ=MONTHLY;BYDAY=-1FR', 'Every month on the last Friday'],
    ['FREQ=MONTHLY;BYDAY=3TU', 'Every month on the third Tuesday'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', 'Every month on the last day'],
    ['FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 'Every month on the last weekday'],
    ['FREQ=YEARLY', 'Every year on November 17'],
    ['FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', 'Every year on the fourth Thursday of November'],
    ['FREQ=DAILY;COUNT=10', 'Every day, 10 times'],
    ['FREQ=WEEKLY;UNTIL=20261231T235959Z', 'Every week, until Dec 31, 2026'],
    ['FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO', 'Every year, with more conditions'],
  ])('%s → %s', (text, words) => {
    expect(describeRule(parsed(text), '2026-11-17')).toBe(words);
  });
});

describe('recurrence sets', () => {
  const at = (s: string) => toLocalSeconds(s);
  const daily = parseRule('FREQ=DAILY;COUNT=5');
  if (!daily.ok) throw new Error(daily.message);
  const base = {
    start: at('2026-11-02T09:00:00'),
    rules: [daily.rule],
    exRules: [],
    rDates: [],
    exDates: [],
  };
  const range = [at('2026-01-01T00:00:00'), at('2027-01-01T00:00:00')] as const;
  const days = (starts: number[]) => starts.map((s) => fromLocalSeconds(s).slice(8, 10));

  it('adds RDATEs, removes EXDATEs, and never repeats a start', () => {
    const set = {
      ...base,
      rDates: [at('2026-11-20T09:00:00'), at('2026-11-03T09:00:00')],
      exDates: [at('2026-11-04T09:00:00')],
    };
    expect(days(expandSet(set, ...range).starts)).toEqual(['02', '03', '05', '06', '20']);
  });

  it('removes what an EXRULE names', () => {
    const odd = parseRule('FREQ=DAILY;INTERVAL=2');
    if (!odd.ok) throw new Error(odd.message);
    expect(days(expandSet({ ...base, exRules: [odd.rule] }, ...range).starts)).toEqual(['03', '05']);
  });

  it('is DTSTART and the RDATEs alone with no rule', () => {
    const set = { ...base, rules: [], rDates: [at('2026-12-01T09:00:00')] };
    expect(expandSet(set, ...range).starts.map(fromLocalSeconds)).toEqual([
      '2026-11-02T09:00:00',
      '2026-12-01T09:00:00',
    ]);
  });

  it('says whether a time is one of the starts', () => {
    expect(isInSet(base, at('2026-11-06T09:00:00'))).toBe(true);
    expect(isInSet(base, at('2026-11-07T09:00:00'))).toBe(false);
    expect(isInSet({ ...base, exDates: [at('2026-11-06T09:00:00')] }, at('2026-11-06T09:00:00'))).toBe(false);
  });
});
