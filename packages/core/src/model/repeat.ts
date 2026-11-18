/**
 * The repeat field and its Custom… dialog (PRD §8.1): the menu's presets, the dialog's choices read from a rule
 * and written back, and the end of a repeat as a date in the event's own clock.
 */
import type { TimeValue } from '../ical/values.ts';
import { addDays, weekday, type PlainDate, type Weekday } from '../plainDate.ts';
import {
  SECONDS_PER_DAY,
  dateOf,
  fromLocalSeconds,
  plainDateTime,
  toLocalSeconds,
} from '../time/dateTime.ts';
import { rule, type RecurrenceRule, type RuleUntil, type WeekdayNum } from '../time/rrule.ts';
import { toInstant, toLocal, type Zone } from '../time/zones.ts';

export const REPEAT_PRESETS = [
  { id: 'never', label: 'Never' },
  { id: 'daily', label: 'Every Day' },
  { id: 'weekdays', label: 'Every Weekday' },
  { id: 'weekly', label: 'Every Week' },
  { id: 'biweekly', label: 'Every 2 Weeks' },
  { id: 'monthly', label: 'Every Month' },
  { id: 'yearly', label: 'Every Year' },
] as const;
export type RepeatPreset = (typeof REPEAT_PRESETS)[number]['id'];

const MON_FRI: readonly Weekday[] = [1, 2, 3, 4, 5];
const plainDays = (days: readonly Weekday[]): WeekdayNum[] => days.map((w) => ({ weekday: w, ordinal: 0 }));

/** Only freq, interval and BYDAY Monday to Friday may be set for a rule to be a preset; the end doesn't count. */
function bareParts(r: RecurrenceRule): boolean {
  return [
    r.bySecond,
    r.byMinute,
    r.byHour,
    r.byMonthDay,
    r.byYearDay,
    r.byWeekNo,
    r.byMonth,
    r.bySetPos,
  ].every((p) => p.length === 0);
}

const isMonFri = (days: readonly WeekdayNum[]) =>
  days.length === 5 &&
  days.every((d) => d.ordinal === 0) &&
  MON_FRI.every((w) => days.some((d) => d.weekday === w));

/** Which menu item a rule is, or 'custom'. Null (no rule) is Never. */
export function presetOf(r: RecurrenceRule | null): RepeatPreset | 'custom' {
  if (!r) return 'never';
  if (!bareParts(r)) return 'custom';
  if (r.byDay.length)
    return r.interval === 1 && isMonFri(r.byDay) && r.freq !== 'MONTHLY' ? 'weekdays' : 'custom';
  if (r.freq === 'DAILY' && r.interval === 1) return 'daily';
  if (r.freq === 'WEEKLY' && r.interval === 1) return 'weekly';
  if (r.freq === 'WEEKLY' && r.interval === 2) return 'biweekly';
  if (r.freq === 'MONTHLY' && r.interval === 1) return 'monthly';
  if (r.freq === 'YEARLY' && r.interval === 1) return 'yearly';
  return 'custom';
}

/** The rule for a menu item, keeping the old rule's end and week start. */
export function presetRule(preset: RepeatPreset, old: RecurrenceRule | null): RecurrenceRule | null {
  const keep = { count: old?.count ?? null, until: old?.until ?? null, wkst: old?.wkst ?? 1 };
  switch (preset) {
    case 'never':
      return null;
    case 'daily':
      return rule('DAILY', keep);
    case 'weekdays':
      return rule('WEEKLY', { ...keep, byDay: plainDays(MON_FRI) });
    case 'weekly':
      return rule('WEEKLY', keep);
    case 'biweekly':
      return rule('WEEKLY', { ...keep, interval: 2 });
    case 'monthly':
      return rule('MONTHLY', keep);
    case 'yearly':
      return rule('YEARLY', keep);
  }
}

/** What the Custom… dialog shows. */
export interface CustomRepeat {
  readonly freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  readonly interval: number;
  /** Weekly: the days it happens on. */
  readonly weekdays: readonly Weekday[];
  /** Monthly: on a day number, on an nth weekday (-1 = last), or on the last day. */
  readonly monthly:
    | { readonly kind: 'day'; readonly day: number }
    | { readonly kind: 'weekday'; readonly ordinal: number; readonly weekday: Weekday }
    | { readonly kind: 'last' };
  /** Yearly: the months it happens in, and optionally an nth weekday of them. */
  readonly months: readonly number[];
  readonly yearlyOn: { readonly ordinal: number; readonly weekday: Weekday } | null;
  readonly end:
    | { readonly kind: 'never' }
    | { readonly kind: 'date'; readonly date: PlainDate }
    | { readonly kind: 'count'; readonly count: number };
}

/** The nth weekday a date is in its month: 1 to 4, or -1 (last) for a fifth. */
export function ordinalOf(date: PlainDate): number {
  const n = Math.ceil(Number(date.slice(8, 10)) / 7);
  return n === 5 ? -1 : n;
}

/** Whether a date is its weekday's last in the month, so "last" fits it as well as "fourth". */
export function isLastWeekdayOf(date: PlainDate): boolean {
  return addDays(date, 7).slice(5, 7) !== date.slice(5, 7);
}

/** The dialog's starting point for a new rule from an event starting on `start`. */
export function customDefaults(start: PlainDate, freq: CustomRepeat['freq'] = 'WEEKLY'): CustomRepeat {
  return {
    freq,
    interval: 1,
    weekdays: [weekday(start)],
    monthly: { kind: 'day', day: Number(start.slice(8, 10)) },
    months: [Number(start.slice(5, 7))],
    yearlyOn: null,
    end: { kind: 'never' },
  };
}

/** How the event's start and its zone turn an UNTIL into a date, and back. */
export interface RepeatClock {
  readonly start: TimeValue;
  readonly zone: Zone;
  readonly displayZone: string;
}

const startDate = (clock: RepeatClock): PlainDate =>
  clock.start.kind === 'date' ? clock.start.date : dateOf(clock.start.dateTime);

/** The last day a rule's UNTIL lets through, on the event's own clock. */
export function untilDate(until: RuleUntil, clock: RepeatClock): PlainDate {
  if (until.kind === 'date') return until.date;
  if (!until.utc) return dateOf(until.dateTime);
  const local = toLocal(toLocalSeconds(until.dateTime), clock.zone, clock.displayZone);
  return dateOf(fromLocalSeconds(local));
}

/** UNTIL for "end on `date`": the end of that day on the event's clock, in UTC when it has a zone (RFC 5545). */
export function untilOn(date: PlainDate, clock: RepeatClock): RuleUntil {
  const s = clock.start;
  if (s.kind === 'date') return { kind: 'date', date };
  const last = toLocalSeconds(plainDateTime(date)) + SECONDS_PER_DAY - 1;
  if (!s.utc && !s.tzid) return { kind: 'date-time', dateTime: fromLocalSeconds(last), utc: false };
  return {
    kind: 'date-time',
    dateTime: fromLocalSeconds(toInstant(last, clock.zone, clock.displayZone)),
    utc: true,
  };
}

/** The dialog's choices for a rule, or null when the dialog can't show it (§8.1: shown in words instead). */
export function customOf(r: RecurrenceRule, clock: RepeatClock): CustomRepeat | null {
  const start = startDate(clock);
  if ([r.bySecond, r.byMinute, r.byHour, r.byYearDay, r.byWeekNo, r.bySetPos].some((p) => p.length > 0))
    return null;
  const base = customDefaults(start);
  const end: CustomRepeat['end'] = r.count
    ? { kind: 'count', count: r.count }
    : r.until
      ? { kind: 'date', date: untilDate(r.until, clock) }
      : { kind: 'never' };
  const plain = r.byDay.every((d) => d.ordinal === 0);
  switch (r.freq) {
    case 'DAILY':
      if (r.byMonthDay.length || r.byMonth.length) return null;
      if (!r.byDay.length) return { ...base, freq: 'DAILY', interval: r.interval, end };
      // Every weekday, written as DAILY by some apps, is the weekly Monday-to-Friday choice.
      return r.interval === 1 && isMonFri(r.byDay)
        ? { ...base, freq: 'WEEKLY', weekdays: MON_FRI, end }
        : null;
    case 'WEEKLY':
      if (r.byMonthDay.length || r.byMonth.length || !plain) return null;
      return {
        ...base,
        freq: 'WEEKLY',
        interval: r.interval,
        weekdays: r.byDay.length ? r.byDay.map((d) => d.weekday) : base.weekdays,
        end,
      };
    case 'MONTHLY': {
      if (r.byMonth.length) return null;
      const [md, ...moreMd] = r.byMonthDay;
      const [wd, ...moreWd] = r.byDay;
      if (moreMd.length || moreWd.length || (md !== undefined && wd)) return null;
      if (md === -1)
        return { ...base, freq: 'MONTHLY', interval: r.interval, monthly: { kind: 'last' }, end };
      if (md !== undefined)
        return md > 0
          ? { ...base, freq: 'MONTHLY', interval: r.interval, monthly: { kind: 'day', day: md }, end }
          : null;
      if (wd)
        return wd.ordinal !== 0 && (wd.ordinal === -1 || (wd.ordinal >= 1 && wd.ordinal <= 4))
          ? {
              ...base,
              freq: 'MONTHLY',
              interval: r.interval,
              monthly: { kind: 'weekday', ordinal: wd.ordinal, weekday: wd.weekday },
              end,
            }
          : null;
      return { ...base, freq: 'MONTHLY', interval: r.interval, end };
    }
    case 'YEARLY': {
      const months = r.byMonth.length ? r.byMonth : base.months;
      const [wd, ...moreWd] = r.byDay;
      if (moreWd.length || (wd && (wd.ordinal === 0 || r.byMonthDay.length))) return null;
      if (r.byMonthDay.length && (r.byMonthDay.length > 1 || r.byMonthDay[0] !== Number(start.slice(8, 10))))
        return null;
      return {
        ...base,
        freq: 'YEARLY',
        interval: r.interval,
        months,
        yearlyOn: wd ? { ordinal: wd.ordinal, weekday: wd.weekday } : null,
        end,
      };
    }
    case 'HOURLY':
    case 'MINUTELY':
    case 'SECONDLY':
      return null;
  }
}

/**
 * The rule the dialog's choices make, keeping the old rule's week start and parts Daybird doesn't use. The days
 * are written out even where the start implies them, so the rule means the same in a series split at any occurrence.
 */
export function ruleFromCustom(
  c: CustomRepeat,
  clock: RepeatClock,
  old: RecurrenceRule | null,
): RecurrenceRule {
  const common = {
    count: c.end.kind === 'count' ? Math.max(1, Math.floor(c.end.count)) : null,
    until: c.end.kind === 'date' ? untilOn(c.end.date, clock) : null,
    interval: Math.max(1, Math.floor(c.interval)),
    wkst: old?.wkst ?? 1,
    extra: old?.extra ?? [],
  };
  const sorted = <T extends number>(xs: readonly T[]): T[] => [...new Set(xs)].sort((a, b) => a - b);
  switch (c.freq) {
    case 'DAILY':
      return rule('DAILY', common);
    case 'WEEKLY': {
      const days = sorted(c.weekdays);
      return rule('WEEKLY', {
        ...common,
        byDay: plainDays(days.length ? days : [weekday(startDate(clock))]),
      });
    }
    case 'MONTHLY': {
      const m = c.monthly;
      if (m.kind === 'last') return rule('MONTHLY', { ...common, byMonthDay: [-1] });
      if (m.kind === 'weekday')
        return rule('MONTHLY', { ...common, byDay: [{ weekday: m.weekday, ordinal: m.ordinal }] });
      return rule('MONTHLY', { ...common, byMonthDay: [m.day] });
    }
    case 'YEARLY': {
      const months = sorted(c.months);
      return rule('YEARLY', {
        ...common,
        byMonth: months.length ? months : [Number(startDate(clock).slice(5, 7))],
        byDay: c.yearlyOn ? [{ weekday: c.yearlyOn.weekday, ordinal: c.yearlyOn.ordinal }] : [],
      });
    }
  }
}
