/**
 * What each view shows (PRD §6): the dates it covers around the anchor, how ‹ and › move it, and the range
 * title in the toolbar (§5.1).
 */
import {
  addDays,
  addMonths,
  datePart,
  diffDays,
  startOfMonth,
  startOfWeek,
  startOfYear,
  type PlainDate,
  type Weekday,
} from './plainDate.ts';

export const VIEWS = ['day', 'week', 'month', 'year', 'agenda'] as const;
export type View = (typeof VIEWS)[number];

export function isView(value: unknown): value is View {
  return typeof value === 'string' && (VIEWS as readonly string[]).includes(value);
}

/** Dates from `start` up to but not including `end`. */
export interface DateRange {
  readonly start: PlainDate;
  readonly end: PlainDate;
}

/** How many days Agenda loads at a time (§6.4). */
export const AGENDA_DAYS = 60;

/**
 * The month grid (§6.2): whole weeks from the week holding the 1st, six of them unless the month fits in
 * five.
 */
export function monthGrid(anchor: PlainDate, weekStart: Weekday): DateRange {
  const first = startOfMonth(anchor);
  const start = startOfWeek(first, weekStart);
  const nextMonth = addMonths(first, 1);
  const weeks = diffDays(start, nextMonth) <= 35 ? 5 : 6;
  return { start, end: addDays(start, weeks * 7) };
}

/** The dates a view shows for `anchor`. */
export function viewRange(view: View, anchor: PlainDate, weekStart: Weekday): DateRange {
  switch (view) {
    case 'day':
      return { start: anchor, end: addDays(anchor, 1) };
    case 'week': {
      const start = startOfWeek(anchor, weekStart);
      return { start, end: addDays(start, 7) };
    }
    case 'month':
      return monthGrid(anchor, weekStart);
    case 'year': {
      const start = startOfYear(anchor);
      return { start, end: addMonths(start, 12) };
    }
    case 'agenda':
      return { start: anchor, end: addDays(anchor, AGENDA_DAYS) };
  }
}

/** The anchor after ‹ (`direction` -1) or › (+1): by the view's unit, Agenda by a week (§6.5). */
export function stepAnchor(view: View, anchor: PlainDate, direction: -1 | 1): PlainDate {
  switch (view) {
    case 'day':
      return addDays(anchor, direction);
    case 'week':
    case 'agenda':
      return addDays(anchor, 7 * direction);
    case 'month':
      return addMonths(anchor, direction);
    case 'year':
      return addMonths(anchor, 12 * direction);
  }
}

/** A plain date as a UTC instant, so `Intl` formats the date itself whatever the system zone. */
function utc(date: PlainDate): Date {
  const { year, month, day } = datePart(date);
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(year);
  return d;
}

/** Formats a plain date with `Intl`, as that date whatever the system zone. */
export function formatPlainDate(
  date: PlainDate,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(utc(date));
}

/**
 * The label beside `hour` (0–23) in the time grid: "9 AM" or "09:00". `hour12` is the time-format setting
 * (§13): true or false forces a clock, undefined follows the locale.
 */
export function hourLabel(hour: number, locale: string | undefined, hour12?: boolean): string {
  const at = Date.UTC(2000, 0, 1, hour);
  const own = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    timeZone: 'UTC',
    ...(hour12 === undefined ? {} : { hour12 }),
  });
  if (own.resolvedOptions().hour12) return own.format(at);
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(at);
}

/** The toolbar title, in two parts so the month can be bold and the year light (§5.1). */
export interface RangeTitle {
  readonly main: string;
  readonly year: string;
}

/**
 * The range title: "November 2026", "Nov 16 – 22, 2026", "Tuesday, November 17, 2026", "2026". Agenda
 * names the anchor's month.
 */
export function rangeTitle(view: View, anchor: PlainDate, weekStart: Weekday, locale?: string): RangeTitle {
  const { year } = datePart(anchor);
  switch (view) {
    case 'day':
      return {
        main: formatPlainDate(anchor, locale, { weekday: 'long', month: 'long', day: 'numeric' }),
        year: String(year),
      };
    case 'week': {
      const { start, end } = viewRange('week', anchor, weekStart);
      const last = addDays(end, -1);
      const a = datePart(start);
      const b = datePart(last);
      const main =
        a.month === b.month
          ? `${formatPlainDate(start, locale, { month: 'short', day: 'numeric' })} – ${b.day}`
          : `${formatPlainDate(start, locale, { month: 'short', day: 'numeric' })} – ${formatPlainDate(last, locale, { month: 'short', day: 'numeric' })}`;
      return { main, year: a.year === b.year ? String(b.year) : `${a.year} – ${b.year}` };
    }
    case 'month':
    case 'agenda':
      return { main: formatPlainDate(anchor, locale, { month: 'long' }), year: String(year) };
    case 'year':
      return { main: '', year: String(year) };
  }
}

/** The locale's first day of the week, or Sunday when the runtime can't say. */
export function localeWeekStart(locale?: string): Weekday {
  try {
    const info = new Intl.Locale(locale ?? Intl.DateTimeFormat().resolvedOptions().locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay;
    if (first === undefined) return 0;
    return (first % 7) as Weekday;
  } catch {
    return 0;
  }
}

/** A time of day for an event chip and its label, "9:30 AM" or "09:30", on the display zone's clock. */
export function timeLabel(
  utcSeconds: number,
  locale: string | undefined,
  zone: string,
  hour12?: boolean,
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
    ...(hour12 === undefined ? {} : { hour12 }),
  }).format(utcSeconds * 1000);
}
