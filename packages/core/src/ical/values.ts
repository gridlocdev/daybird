/**
 * iCalendar DATE, DATE-TIME, DURATION and PERIOD values (RFC 5545 §3.3), read from and written to
 * properties such as DTSTART, DTEND, DURATION, RDATE and EXDATE.
 */
import { isPlainDate, type PlainDate } from '../plainDate.ts';
import { isPlainDateTime, type PlainDateTime } from '../time/dateTime.ts';
import { paramValue } from './document.ts';
import type { ContentLine, Parameter } from './contentLine.ts';

/** A DATE, or a DATE-TIME that is UTC (`Z`), in a TZID, or floating (neither). */
export type TimeValue =
  | { readonly kind: 'date'; readonly date: PlainDate }
  | {
      readonly kind: 'date-time';
      readonly dateTime: PlainDateTime;
      readonly utc: boolean;
      readonly tzid: string | null;
    };

export interface Duration {
  readonly negative: boolean;
  readonly weeks: number;
  readonly days: number;
  /** Hours, minutes and seconds, as exact seconds. */
  readonly seconds: number;
}

export function dateValue(date: PlainDate): TimeValue {
  return { kind: 'date', date };
}

export function dateTimeValue(
  dateTime: PlainDateTime,
  zone: 'utc' | 'floating' | { tzid: string },
): TimeValue {
  return typeof zone === 'object'
    ? { kind: 'date-time', dateTime, utc: false, tzid: zone.tzid }
    : { kind: 'date-time', dateTime, utc: zone === 'utc', tzid: null };
}

/** One DATE or DATE-TIME (`20261117`, `20261117T090000`, `20261117T090000Z`), or null. */
export function parseTimeText(text: string, tzid: string | null, forceDate = false): TimeValue | null {
  const t = text.trim();
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (d) {
    const date = `${d[1]}-${d[2]}-${d[3]}`;
    return isPlainDate(date) ? { kind: 'date', date } : null;
  }
  if (forceDate) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(t);
  if (!m) return null;
  const dateTime = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (!isPlainDateTime(dateTime)) return null;
  const utc = m[7] !== '';
  return { kind: 'date-time', dateTime, utc, tzid: utc ? null : tzid };
}

/** DTSTART, DTEND, RECURRENCE-ID and the like: one value, honouring VALUE=DATE and TZID. */
export function readTimeProperty(line: ContentLine): TimeValue | null {
  const forceDate = paramValue(line, 'VALUE')?.toUpperCase() === 'DATE';
  return parseTimeText(line.value, paramValue(line, 'TZID') ?? null, forceDate);
}

/**
 * RDATE and EXDATE: a comma-separated list. PERIOD values (`start/end`, `start/duration`) give their start.
 * Null when any item doesn't read.
 */
export function readTimeList(line: ContentLine): TimeValue[] | null {
  const forceDate = paramValue(line, 'VALUE')?.toUpperCase() === 'DATE';
  const tzid = paramValue(line, 'TZID') ?? null;
  const out: TimeValue[] = [];
  for (const item of line.value.split(',')) {
    if (item.trim() === '') continue;
    const v = parseTimeText(item.split('/')[0] ?? '', tzid, forceDate);
    if (!v) return null;
    out.push(v);
  }
  return out;
}

export function formatTimeText(value: TimeValue): string {
  if (value.kind === 'date') return value.date.replaceAll('-', '');
  return `${value.dateTime.replace(/[-:]/g, '')}${value.utc ? 'Z' : ''}`;
}

/** The parameters a time property needs: VALUE=DATE for dates, TZID for zoned times. */
export function timeParams(value: TimeValue): Parameter[] {
  if (value.kind === 'date') return [{ name: 'VALUE', values: ['DATE'] }];
  return value.tzid ? [{ name: 'TZID', values: [value.tzid] }] : [];
}

/** A DURATION such as `P1W`, `-PT15M` or `P1DT2H30M`, or null. */
export function parseDuration(text: string): Duration | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(text.trim());
  if (!m || /T$/i.test(text.trim()) || text.trim().replace(/^[+-]/, '').toUpperCase() === 'P') return null;
  return {
    negative: m[1] === '-',
    weeks: Number(m[2] ?? 0),
    days: Number(m[3] ?? 0),
    seconds: Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0),
  };
}

export function formatDuration(d: Duration): string {
  const sign = d.negative ? '-' : '';
  const h = Math.floor(d.seconds / 3600);
  const min = Math.floor((d.seconds % 3600) / 60);
  const s = d.seconds % 60;
  const time = d.seconds ? `T${h ? `${h}H` : ''}${min ? `${min}M` : ''}${s ? `${s}S` : ''}` : '';
  if (d.weeks && !d.days && !d.seconds) return `${sign}P${d.weeks}W`;
  const days = d.weeks * 7 + d.days;
  if (!days && !time) return `${sign}PT0S`;
  return `${sign}P${days ? `${days}D` : ''}${time}`;
}

/** A duration of whole seconds, written in days, hours and minutes. */
export function durationFromSeconds(total: number): Duration {
  const abs = Math.abs(total);
  return { negative: total < 0, weeks: 0, days: Math.floor(abs / 86_400), seconds: abs % 86_400 };
}
