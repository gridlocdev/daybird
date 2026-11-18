/**
 * Dates, times and durations as typed on the command line (PRD §16). Times are wall-clock times in the zone
 * (`--zone`, else the system's); a trailing `Z` means UTC.
 */
import {
  addDays,
  addSeconds,
  fromLocalSeconds,
  ianaZone,
  isIanaZone,
  isPlainDateTime,
  localSecondsOfDate,
  parseDuration,
  parsePlainDate,
  toInstant,
  toLocal,
  toLocalSeconds,
  zoneDateTime,
  type PlainDate,
  type PlainDateTime,
  type TimeValue,
} from '@daybird/core';
import { UserError } from './folder.ts';

export type When =
  | { readonly kind: 'date'; readonly date: PlainDate }
  | { readonly kind: 'date-time'; readonly dateTime: PlainDateTime; readonly utc: boolean };

/** `2026-11-17`, `2026-11-17T09:30`, `2026-11-17 09:30:00` or `2026-11-17T09:30Z`. */
export function parseWhen(text: string, what: string): When {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    if (parsePlainDate(t) === null) throw new UserError(`${what}: “${text}” isn’t a date.`);
    return { kind: 'date', date: t };
  }
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(Z)?$/i.exec(t);
  const dateTime = m ? `${m[1]}T${m[2]!.padStart(2, '0')}:${m[3]}:${m[4] ?? '00'}` : '';
  if (!m || !isPlainDateTime(dateTime))
    throw new UserError(
      `${what}: “${text}” isn’t a date (2026-11-17) or a date and time (2026-11-17T09:30).`,
    );
  return { kind: 'date-time', dateTime, utc: m[5] !== undefined };
}

export function parseDate(text: string, what: string): PlainDate {
  const w = parseWhen(text, what);
  if (w.kind !== 'date') throw new UserError(`${what}: “${text}” should be a date such as 2026-11-17.`);
  return w.date;
}

/** The zone times are typed and shown in. */
export function checkZone(zone: string): string {
  if (zone !== 'UTC' && !isIanaZone(zone)) throw new UserError(`--zone: “${zone}” isn’t a time zone.`);
  return zone;
}

/** A typed date-time as an event time in `zone`. */
export function timeValue(w: When & { kind: 'date-time' }, zone: string): TimeValue {
  return zoneDateTime(w.dateTime, w.utc ? 'UTC' : zone);
}

/** `PT1H30M`, `90m`, `1h30m`, `2h`, `1d`: seconds, above zero. */
export function parseLength(text: string): number {
  const t = text.trim();
  const iso = /^P/i.test(t) ? parseDuration(t) : null;
  if (iso && !iso.negative) {
    const s = iso.weeks * 7 * 86_400 + iso.days * 86_400 + iso.seconds;
    if (s > 0) return s;
  }
  const m = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/i.exec(t);
  const s = m ? Number(m[1] ?? 0) * 86_400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 : 0;
  if (s <= 0) throw new UserError(`--duration: “${text}” isn’t a length such as 45m, 1h30m or PT1H.`);
  return s;
}

/** The end of a timed event `seconds` after its start, on the same clock. */
export function endAfter(start: TimeValue, seconds: number): TimeValue {
  if (start.kind !== 'date-time') throw new Error('A timed start was expected.');
  return { ...start, dateTime: addSeconds(start.dateTime, seconds) };
}

/** UTC seconds of the start of `date` in `zone`. */
export function dayStart(date: PlainDate, zone: string): number {
  return toInstant(localSecondsOfDate(date), ianaZone(zone), zone);
}

/** The days from `from` to `to`, both included, as UTC seconds. */
export function dayRange(from: PlainDate, to: PlainDate, zone: string): { from: number; to: number } {
  if (to < from) throw new UserError(`--to (${to}) is before --from (${from}).`);
  return { from: dayStart(from, zone), to: dayStart(addDays(to, 1), zone) };
}

/** An instant as a wall-clock date-time in `zone`. */
export function wallClock(utc: number, zone: string): PlainDateTime {
  return fromLocalSeconds(toLocal(utc, ianaZone(zone), zone));
}

/** The key that names the occurrence starting at `w` on the event's own clock (§8.1). */
export function occurrenceKey(w: When): number {
  return w.kind === 'date' ? localSecondsOfDate(w.date) : toLocalSeconds(w.dateTime);
}
