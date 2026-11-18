/**
 * Calendar dates without a time or a zone (PRD §4.1): `YYYY-MM-DD` strings, compared and sorted as text. All
 * arithmetic is on whole days since 1970-01-01, never on `Date` in local time, so a daylight-saving change
 * can't move a date.
 */

/** A date as `YYYY-MM-DD`, years 0001–9999. */
export type PlainDate = string;

/** 0 = Sunday … 6 = Saturday, as in `Date#getUTCDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in `month` (1–12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function plainDate(year: number, month: number, day: number): PlainDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The parts of a date, or null when `text` isn't a real `YYYY-MM-DD` date (2026-02-30 isn't). */
export function parsePlainDate(text: string): DateParts | null {
  const m = PATTERN.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isPlainDate(text: unknown): text is PlainDate {
  return typeof text === 'string' && parsePlainDate(text) !== null;
}

function parts(date: PlainDate): DateParts {
  const p = parsePlainDate(date);
  if (!p) throw new RangeError(`Not a date: ${date}`);
  return p;
}

/** Days since 1970-01-01 (negative before it). Howard Hinnant's days_from_civil. */
export function toEpochDay(date: PlainDate): number {
  const { year, month, day } = parts(date);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The date `days` after 1970-01-01. Hinnant's civil_from_days. */
export function fromEpochDay(days: number): PlainDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return plainDate(yoe + era * 400 + (month <= 2 ? 1 : 0), month, day);
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffDays(from: PlainDate, to: PlainDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** Adds months, keeping the day or clamping it to the month's last day (Jan 31 + 1 month = Feb 28 or 29). */
export function addMonths(date: PlainDate, months: number): PlainDate {
  const { year, month, day } = parts(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return plainDate(y, m, Math.min(day, daysInMonth(y, m)));
}

export function weekday(date: PlainDate): Weekday {
  // 1970-01-01 was a Thursday.
  return ((((toEpochDay(date) + 4) % 7) + 7) % 7) as Weekday;
}

export function startOfMonth(date: PlainDate): PlainDate {
  const { year, month } = parts(date);
  return plainDate(year, month, 1);
}

export function startOfYear(date: PlainDate): PlainDate {
  return plainDate(parts(date).year, 1, 1);
}

/** The first day of the week holding `date`, for weeks that start on `weekStart`. */
export function startOfWeek(date: PlainDate, weekStart: Weekday): PlainDate {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}

/** The ISO 8601 week number (weeks start on Monday; week 1 holds the year's first Thursday). */
export function isoWeek(date: PlainDate): number {
  const thursday = addDays(date, 3 - ((weekday(date) + 6) % 7));
  return Math.floor(diffDays(startOfYear(thursday), thursday) / 7) + 1;
}

export function datePart(date: PlainDate): DateParts {
  return parts(date);
}

/** Today's date in `timeZone` (the system's when left out) at the instant `now` (ms since the epoch). */
export function todayIn(now: number, timeZone?: string): PlainDate {
  const f = new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return plainDate(Number(p.year), Number(p.month), Number(p.day));
}
