/**
 * RFC 5545 recurrence rules (PRD §4.4): parsing, writing, and expansion on the wall clock. Expansion works in
 * local seconds (see `dateTime.ts`), so a 9:00 weekly event stays at 9:00 whatever the zone does; the caller
 * turns the results into instants. Each period (year, month, week, day, hour, minute, second) is expanded to
 * its candidate days and times, the BYxxx parts filter them, BYSETPOS picks from what's left, and invalid
 * dates are skipped rather than clamped.
 */
import { isPlainDate, isLeapYear, toEpochDay, type PlainDate, type Weekday } from '../plainDate.ts';
import { SECONDS_PER_DAY, isPlainDateTime, toLocalSeconds, type PlainDateTime } from './dateTime.ts';

export const FREQUENCIES = [
  'SECONDLY',
  'MINUTELY',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export interface WeekdayNum {
  readonly weekday: Weekday;
  /** 0 for every such weekday; 1 = first, -1 = last. */
  readonly ordinal: number;
}

export type RuleUntil =
  | { readonly kind: 'date'; readonly date: PlainDate }
  | { readonly kind: 'date-time'; readonly dateTime: PlainDateTime; readonly utc: boolean };

export interface RecurrenceRule {
  readonly freq: Frequency;
  readonly interval: number;
  readonly count: number | null;
  readonly until: RuleUntil | null;
  readonly bySecond: readonly number[];
  readonly byMinute: readonly number[];
  readonly byHour: readonly number[];
  readonly byDay: readonly WeekdayNum[];
  readonly byMonthDay: readonly number[];
  readonly byYearDay: readonly number[];
  readonly byWeekNo: readonly number[];
  readonly byMonth: readonly number[];
  readonly bySetPos: readonly number[];
  readonly wkst: Weekday;
  /** Parts Daybird doesn't use (X- parts, RSCALE…), kept in order for writing back. */
  readonly extra: readonly (readonly [string, string])[];
}

export type ParsedRule =
  { readonly ok: true; readonly rule: RecurrenceRule } | { readonly ok: false; readonly message: string };

/** The cap on candidate instants per series per range (PRD §4.4). */
export const EXPANSION_CAP = 50_000;

export function rule(freq: Frequency, parts: Partial<Omit<RecurrenceRule, 'freq'>> = {}): RecurrenceRule {
  return {
    freq,
    interval: 1,
    count: null,
    until: null,
    bySecond: [],
    byMinute: [],
    byHour: [],
    byDay: [],
    byMonthDay: [],
    byYearDay: [],
    byWeekNo: [],
    byMonth: [],
    bySetPos: [],
    wkst: 1,
    extra: [],
    ...parts,
  };
}

function intList(text: string, min: number, max: number, signed: boolean): number[] | null {
  const out: number[] = [];
  for (const part of text.split(',')) {
    if (!/^[+-]?\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if ((n < 0 && !signed) || Math.abs(n) < min || Math.abs(n) > max) return null;
    out.push(n);
  }
  return out;
}

function weekdayCode(code: string): Weekday | null {
  const index = (WEEKDAY_CODES as readonly string[]).indexOf(code.toUpperCase());
  return index < 0 ? null : (index as Weekday);
}

/** Reads an RRULE (or EXRULE) value: `FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T235959Z`. */
export function parseRule(value: string): ParsedRule {
  const fail = (message: string): ParsedRule => ({ ok: false, message });
  let freq: Frequency | null = null;
  const parts: { -readonly [K in keyof RecurrenceRule]?: RecurrenceRule[K] } = {};
  const extra: [string, string][] = [];
  for (const piece of value.trim().split(';')) {
    if (piece === '') continue;
    const eq = piece.indexOf('=');
    if (eq < 0) return fail(`"${piece}" has no value.`);
    const name = piece.slice(0, eq).toUpperCase();
    const v = piece.slice(eq + 1).toUpperCase();
    const list = (min: number, max: number, signed: boolean): number[] | null => intList(v, min, max, signed);
    switch (name) {
      case 'FREQ':
        if (!(FREQUENCIES as readonly string[]).includes(v)) return fail(`"${v}" isn't a frequency.`);
        freq = v as Frequency;
        break;
      case 'INTERVAL':
        if (!/^\d+$/.test(v) || Number(v) < 1) return fail('INTERVAL must be a whole number from 1.');
        parts.interval = Number(v);
        break;
      case 'COUNT':
        if (!/^\d+$/.test(v) || Number(v) < 1) return fail('COUNT must be a whole number from 1.');
        parts.count = Number(v);
        break;
      case 'UNTIL': {
        const until = parseUntil(v);
        if (!until) return fail(`"${v}" isn't a date or date-time.`);
        parts.until = until;
        break;
      }
      case 'BYSECOND':
      case 'BYMINUTE':
      case 'BYHOUR': {
        const max = name === 'BYHOUR' ? 23 : name === 'BYMINUTE' ? 59 : 60;
        const nums = list(0, max, false);
        if (!nums) return fail(`${name} has a value out of range.`);
        parts[name === 'BYSECOND' ? 'bySecond' : name === 'BYMINUTE' ? 'byMinute' : 'byHour'] = nums;
        break;
      }
      case 'BYDAY': {
        const days: WeekdayNum[] = [];
        for (const d of v.split(',')) {
          const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d);
          const ordinal = Number(m?.[1] ?? 0);
          if (!m || Math.abs(ordinal) > 53 || (m[1] !== undefined && ordinal === 0)) {
            return fail(`"${d}" isn't a weekday.`);
          }
          days.push({ weekday: weekdayCode(m[2] ?? '') ?? 0, ordinal });
        }
        parts.byDay = days;
        break;
      }
      case 'BYMONTHDAY':
      case 'BYYEARDAY':
      case 'BYWEEKNO':
      case 'BYMONTH':
      case 'BYSETPOS': {
        const range = {
          BYMONTHDAY: [31, true],
          BYYEARDAY: [366, true],
          BYWEEKNO: [53, true],
          BYMONTH: [12, false],
          BYSETPOS: [366, true],
        } as const;
        const [max, signed] = range[name];
        const nums = list(1, max, signed);
        if (!nums) return fail(`${name} has a value out of range.`);
        const key = {
          BYMONTHDAY: 'byMonthDay',
          BYYEARDAY: 'byYearDay',
          BYWEEKNO: 'byWeekNo',
          BYMONTH: 'byMonth',
          BYSETPOS: 'bySetPos',
        } as const;
        parts[key[name]] = nums;
        break;
      }
      case 'WKST': {
        const day = weekdayCode(v);
        if (day === null) return fail(`"${v}" isn't a weekday.`);
        parts.wkst = day;
        break;
      }
      default:
        extra.push([piece.slice(0, eq), piece.slice(eq + 1)]);
    }
  }
  if (!freq) return fail('The rule has no FREQ.');
  if (parts.count !== undefined && parts.until !== undefined)
    return fail('A rule can have COUNT or UNTIL, not both.');
  return { ok: true, rule: rule(freq, { ...parts, extra }) };
}

function parseUntil(v: string): RuleUntil | null {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date) {
    const d = `${date[1]}-${date[2]}-${date[3]}`;
    return isPlainDate(d) ? { kind: 'date', date: d } : null;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const dateTime = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return isPlainDateTime(dateTime) ? { kind: 'date-time', dateTime, utc: m[7] === 'Z' } : null;
}

export function formatUntil(until: RuleUntil): string {
  if (until.kind === 'date') return until.date.replaceAll('-', '');
  return `${until.dateTime.replace(/[-:]/g, '')}${until.utc ? 'Z' : ''}`;
}

/** The rule as an RRULE value, parts in a fixed order. */
export function formatRule(r: RecurrenceRule): string {
  const out = [`FREQ=${r.freq}`];
  if (r.until) out.push(`UNTIL=${formatUntil(r.until)}`);
  if (r.count !== null) out.push(`COUNT=${r.count}`);
  if (r.interval !== 1) out.push(`INTERVAL=${r.interval}`);
  const lists: [string, readonly number[]][] = [
    ['BYSECOND', r.bySecond],
    ['BYMINUTE', r.byMinute],
    ['BYHOUR', r.byHour],
  ];
  for (const [name, values] of lists) if (values.length) out.push(`${name}=${values.join(',')}`);
  if (r.byDay.length) {
    out.push(`BYDAY=${r.byDay.map((d) => `${d.ordinal || ''}${WEEKDAY_CODES[d.weekday]}`).join(',')}`);
  }
  const more: [string, readonly number[]][] = [
    ['BYMONTHDAY', r.byMonthDay],
    ['BYYEARDAY', r.byYearDay],
    ['BYWEEKNO', r.byWeekNo],
    ['BYMONTH', r.byMonth],
    ['BYSETPOS', r.bySetPos],
  ];
  for (const [name, values] of more) if (values.length) out.push(`${name}=${values.join(',')}`);
  if (r.wkst !== 1) out.push(`WKST=${WEEKDAY_CODES[r.wkst]}`);
  for (const [k, v] of r.extra) out.push(`${k}=${v}`);
  return out.join(';');
}

// ——— Expansion ———

interface Civil {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Hinnant's civil_from_days, with numbers rather than strings (expansion calls it a lot). */
function civil(epochDay: number): Civil {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const month = mp < 10 ? mp + 3 : mp - 9;
  return {
    year: yoe + era * 400 + (month <= 2 ? 1 : 0),
    month,
    day: doy - Math.floor((153 * mp + 2) / 5) + 1,
  };
}

function epochDayOf(year: number, month: number, day: number): number {
  return toEpochDay(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );
}

function monthLength(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function weekdayOf(epochDay: number): Weekday {
  return ((((epochDay + 4) % 7) + 7) % 7) as Weekday;
}

const RANK: Record<Frequency, number> = {
  SECONDLY: 0,
  MINUTELY: 1,
  HOURLY: 2,
  DAILY: 3,
  WEEKLY: 4,
  MONTHLY: 5,
  YEARLY: 6,
};
const PERIOD_SECONDS: Partial<Record<Frequency, number>> = {
  SECONDLY: 1,
  MINUTELY: 60,
  HOURLY: 3600,
  DAILY: SECONDS_PER_DAY,
};

export interface ExpandOptions {
  /** Local seconds: return starts at or after this… */
  readonly from: number;
  /** …and before this. */
  readonly to: number;
  /** UNTIL as local seconds, when it's UTC and the caller has converted it into the event's zone. */
  readonly untilLocal?: number;
  readonly cap?: number;
}

export interface Expansion {
  /** Local seconds, ascending. */
  readonly starts: readonly number[];
  /** True when expansion stopped at the cap (PRD §4.4). */
  readonly capped: boolean;
}

/** The week-number set membership for `day` in `year`, weeks starting on `wkst` (RFC 5545 BYWEEKNO). */
function weekNumbers(year: number, wkst: Weekday): { week1: number; weeks: number } {
  const jan1 = epochDayOf(year, 1, 1);
  const offset = (7 + wkst - weekdayOf(jan1)) % 7;
  const week1 = offset >= 4 ? jan1 + offset - 7 : jan1 + offset;
  const nextJan1 = epochDayOf(year + 1, 1, 1);
  const nextOffset = (7 + wkst - weekdayOf(nextJan1)) % 7;
  const nextWeek1 = nextOffset >= 4 ? nextJan1 + nextOffset - 7 : nextJan1 + nextOffset;
  return { week1, weeks: (nextWeek1 - week1) / 7 };
}

/**
 * The starts of `r` from `start` (local seconds; the series' DTSTART, always the first occurrence) that fall in
 * [`from`, `to`). Expansion runs from the series start, so COUNT is honoured; without COUNT it skips straight
 * to the range.
 */
export function expandRule(r: RecurrenceRule, start: number, options: ExpandOptions): Expansion {
  const cap = options.cap ?? EXPANSION_CAP;
  const startDay = Math.floor(start / SECONDS_PER_DAY);
  const startTime = start - startDay * SECONDS_PER_DAY;
  const startCivil = civil(startDay);
  const rank = RANK[r.freq];
  const until =
    options.untilLocal ??
    (r.until === null
      ? Number.POSITIVE_INFINITY
      : r.until.kind === 'date'
        ? toEpochDay(r.until.date) * SECONDS_PER_DAY + SECONDS_PER_DAY - 1
        : toLocalSeconds(r.until.dateTime));

  // Defaults from DTSTART (RFC 5545 §3.3.10).
  let byMonth = r.byMonth;
  let byMonthDay = r.byMonthDay;
  let byDay = r.byDay;
  if (!r.byWeekNo.length && !r.byYearDay.length && !r.byMonthDay.length && !r.byDay.length) {
    if (r.freq === 'YEARLY') {
      byMonthDay = [startCivil.day];
      if (!byMonth.length) byMonth = [startCivil.month];
    } else if (r.freq === 'MONTHLY') byMonthDay = [startCivil.day];
    else if (r.freq === 'WEEKLY') byDay = [{ weekday: weekdayOf(startDay), ordinal: 0 }];
  }
  // Ordinals only mean something in a month or a year.
  const nthInMonth = r.freq === 'MONTHLY' || (r.freq === 'YEARLY' && byMonth.length > 0);
  const nthInYear = r.freq === 'YEARLY' && byMonth.length === 0;
  const plainDays = new Set(
    byDay.filter((d) => d.ordinal === 0 || !(nthInMonth || nthInYear)).map((d) => d.weekday),
  );
  const nthDays = nthInMonth || nthInYear ? byDay.filter((d) => d.ordinal !== 0) : [];
  const monthSet = new Set(byMonth);
  const monthDaySet = new Set(byMonthDay);
  const yearDaySet = new Set(r.byYearDay);
  const weekNoSet = new Set(r.byWeekNo);
  const weekInfo = new Map<number, { week1: number; weeks: number }>();

  function dayMatches(day: number): boolean {
    const c = civil(day);
    if (monthSet.size && !monthSet.has(c.month)) return false;
    const mLen = monthLength(c.year, c.month);
    if (monthDaySet.size && !monthDaySet.has(c.day) && !monthDaySet.has(c.day - mLen - 1)) return false;
    const yLen = isLeapYear(c.year) ? 366 : 365;
    const yDay = day - epochDayOf(c.year, 1, 1) + 1;
    if (yearDaySet.size && !yearDaySet.has(yDay) && !yearDaySet.has(yDay - yLen - 1)) return false;
    if (weekNoSet.size) {
      let info = weekInfo.get(c.year);
      if (!info) {
        info = weekNumbers(c.year, r.wkst);
        weekInfo.set(c.year, info);
      }
      let n: number;
      let total: number;
      if (day < info.week1) return false;
      n = Math.floor((day - info.week1) / 7) + 1;
      total = info.weeks;
      if (n > total) {
        n = 1; // The first week of next year.
        total = weekNumbers(c.year + 1, r.wkst).weeks;
      }
      if (!weekNoSet.has(n) && !weekNoSet.has(n - total - 1)) return false;
    }
    if (byDay.length) {
      const w = weekdayOf(day);
      let ok = plainDays.has(w);
      for (const d of nthDays) {
        if (ok) break;
        if (d.weekday !== w) continue;
        if (nthInMonth) {
          ok =
            d.ordinal > 0
              ? Math.floor((c.day - 1) / 7) + 1 === d.ordinal
              : Math.floor((mLen - c.day) / 7) + 1 === -d.ordinal;
        } else {
          ok =
            d.ordinal > 0
              ? Math.floor((yDay - 1) / 7) + 1 === d.ordinal
              : Math.floor((yLen - yDay) / 7) + 1 === -d.ordinal;
        }
      }
      if (!ok) return false;
    }
    return true;
  }

  const startH = Math.floor(startTime / 3600);
  const startM = Math.floor((startTime % 3600) / 60);
  const startS = startTime % 60;
  const hours = r.byHour.length ? [...r.byHour].sort((a, b) => a - b) : [startH];
  const minutes = r.byMinute.length ? [...r.byMinute].sort((a, b) => a - b) : [startM];
  const seconds = r.bySecond.length
    ? [...r.bySecond].map((s) => Math.min(s, 59)).sort((a, b) => a - b)
    : [startS];
  const dayTimes: number[] = [];
  for (const h of hours)
    for (const m of minutes) for (const s of seconds) dayTimes.push(h * 3600 + m * 60 + s);

  // Periods: an integer index per frequency, with its first second and the days it spans.
  const weekAnchor = (r.wkst - 4 + 7) % 7; // An epoch day that falls on WKST.
  function periodOf(localSeconds: number): number {
    const day = Math.floor(localSeconds / SECONDS_PER_DAY);
    const c = civil(day);
    switch (r.freq) {
      case 'YEARLY':
        return c.year;
      case 'MONTHLY':
        return c.year * 12 + c.month - 1;
      case 'WEEKLY':
        return Math.floor((day - weekAnchor) / 7);
      case 'DAILY':
      case 'HOURLY':
      case 'MINUTELY':
      case 'SECONDLY':
        return Math.floor(localSeconds / (PERIOD_SECONDS[r.freq] ?? 1));
    }
  }
  function periodStart(p: number): number {
    switch (r.freq) {
      case 'YEARLY':
        return epochDayOf(p, 1, 1) * SECONDS_PER_DAY;
      case 'MONTHLY':
        return epochDayOf(Math.floor(p / 12), (p % 12) + 1, 1) * SECONDS_PER_DAY;
      case 'WEEKLY':
        return (p * 7 + weekAnchor) * SECONDS_PER_DAY;
      case 'DAILY':
      case 'HOURLY':
      case 'MINUTELY':
      case 'SECONDLY':
        return p * (PERIOD_SECONDS[r.freq] ?? 1);
    }
  }
  function periodDays(p: number): [number, number] {
    const first = Math.floor(periodStart(p) / SECONDS_PER_DAY);
    switch (r.freq) {
      case 'YEARLY':
        return [first, epochDayOf(p + 1, 1, 1)];
      case 'MONTHLY':
        return [first, first + monthLength(Math.floor(p / 12), (p % 12) + 1)];
      case 'WEEKLY':
        return [first, first + 7];
      case 'DAILY':
      case 'HOURLY':
      case 'MINUTELY':
      case 'SECONDLY':
        return [first, first + 1];
    }
  }
  function periodTimes(p: number): number[] {
    if (rank >= RANK.DAILY) return dayTimes;
    const s = periodStart(p) % SECONDS_PER_DAY;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (r.byHour.length && !r.byHour.includes(h)) return [];
    if (rank === RANK.HOURLY) {
      const out: number[] = [];
      for (const mm of minutes) for (const ss of seconds) out.push(h * 3600 + mm * 60 + ss);
      return out;
    }
    if (r.byMinute.length && !r.byMinute.includes(m)) return [];
    if (rank === RANK.MINUTELY) return seconds.map((ss) => h * 3600 + m * 60 + ss);
    if (r.bySecond.length && !r.bySecond.includes(sec)) return [];
    return [s];
  }

  const starts: number[] = [];
  let work = 0;
  let capped = false;
  let count = 1;
  if (start >= options.from && start < options.to && start <= until) starts.push(start);
  if (r.count === 1) return { starts, capped };

  const first = periodOf(start);
  let p = first;
  if (r.count === null) {
    const target = periodOf(Math.max(start, options.from));
    p = first + Math.floor((target - first) / r.interval) * r.interval;
  }
  periods: for (; ; p += r.interval) {
    const ps = periodStart(p);
    if (ps >= options.to || ps > until) break;
    if (++work > cap) {
      capped = true;
      break;
    }
    const [dayFrom, dayTo] = periodDays(p);
    const times = periodTimes(p);
    if (!times.length) continue;
    let candidates: number[] = [];
    for (let day = dayFrom; day < dayTo; day++) {
      if (!dayMatches(day)) continue;
      for (const t of times) candidates.push(day * SECONDS_PER_DAY + t);
    }
    work += candidates.length;
    if (r.bySetPos.length && candidates.length) {
      const picked = new Set<number>();
      for (const pos of r.bySetPos) {
        const c = pos > 0 ? candidates[pos - 1] : candidates[candidates.length + pos];
        if (c !== undefined) picked.add(c);
      }
      candidates = [...picked].sort((a, b) => a - b);
    }
    for (const c of candidates) {
      if (c <= start) continue;
      if (c > until || c >= options.to) break periods;
      count++;
      if (c >= options.from) starts.push(c);
      if (r.count !== null && count >= r.count) break periods;
    }
    if (work > cap) {
      capped = true;
      break;
    }
  }
  return { starts, capped };
}
