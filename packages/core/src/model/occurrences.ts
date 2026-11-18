/**
 * Occurrences (PRD §4.1, §4.4): what a view shows, computed for a range and never stored. A repeating series is
 * expanded on its own wall clock, in its own zone; an override replaces the occurrence its RECURRENCE-ID names.
 * Occurrences are named by a key: the occurrence's original start in wall-clock seconds in the master's frame
 * (its zone, or floating, or the date at midnight for all-day), the same number the recurrence set yields.
 */
import { addDays, type PlainDate } from '../plainDate.ts';
import type { ComponentNode } from '../ical/document.ts';
import type { TimeValue } from '../ical/values.ts';
import { SECONDS_PER_DAY, fromLocalSeconds, type PlainDateTime } from '../time/dateTime.ts';
import { expandSet, type RecurrenceSet } from '../time/recurrenceSet.ts';
import type { RecurrenceRule } from '../time/rrule.ts';
import { FLOATING, UTC, resolveTzid, toInstant, toLocal, type Zone } from '../time/zones.ts';
import { calendarZones, seriesOf, type Calendar, type EventSeries } from './calendar.ts';
import { readEvent, wallSeconds, type EventInfo, type Reminder } from './event.ts';

/** The zone a time value is in. An unknown TZID reads as floating, with a problem to show (§4.3). */
export function zoneOf(
  value: TimeValue,
  zones: ReadonlyMap<string, Zone>,
): { zone: Zone; unknown: string | null } {
  if (value.kind === 'date') return { zone: FLOATING, unknown: null };
  if (value.utc) return { zone: UTC, unknown: null };
  if (!value.tzid) return { zone: FLOATING, unknown: null };
  const zone = resolveTzid(value.tzid, zones);
  return zone ? { zone, unknown: null } : { zone: FLOATING, unknown: value.tzid };
}

/** The instant (UTC seconds) a value names. Dates are midnight in the display zone. */
export function instantOf(value: TimeValue, zones: ReadonlyMap<string, Zone>, displayZone: string): number {
  return toInstant(wallSeconds(value), zoneOf(value, zones).zone, displayZone);
}

/** `value` as wall-clock seconds in `frame`'s zone: an occurrence key when `frame` is a master's DTSTART. */
export function keyIn(
  value: TimeValue,
  frame: TimeValue,
  zones: ReadonlyMap<string, Zone>,
  displayZone: string,
): number {
  if (frame.kind === 'date' || value.kind === 'date')
    return wallSeconds(value) - (wallSeconds(value) % SECONDS_PER_DAY);
  const a = zoneOf(value, zones).zone;
  const b = zoneOf(frame, zones).zone;
  if (JSON.stringify(a) === JSON.stringify(b)) return wallSeconds(value);
  return toLocal(toInstant(wallSeconds(value), a, displayZone), b, displayZone);
}

/** A key written back as a value in the master's frame: for RECURRENCE-ID, EXDATE and RDATE. */
export function valueAtKey(key: number, frame: TimeValue): TimeValue {
  if (frame.kind === 'date') return { kind: 'date', date: fromLocalSeconds(key).slice(0, 10) };
  return { ...frame, dateTime: fromLocalSeconds(key) };
}

/** A rule with a UTC UNTIL turned into the master's wall clock, so the expander can compare it. */
function ruleInFrame(rule: RecurrenceRule, zone: Zone, displayZone: string): RecurrenceRule {
  const u = rule.until;
  if (!u || u.kind === 'date' || !u.utc || zone.kind === 'utc') return rule;
  const local = toLocal(
    wallSeconds({ kind: 'date-time', dateTime: u.dateTime, utc: true, tzid: null }),
    zone,
    displayZone,
  );
  return { ...rule, until: { kind: 'date-time', dateTime: fromLocalSeconds(local), utc: false } };
}

/** The master's recurrence set in keys. */
export function recurrenceSetOf(
  master: EventInfo,
  zones: ReadonlyMap<string, Zone>,
  displayZone: string,
): RecurrenceSet {
  const zone = zoneOf(master.start, zones).zone;
  return {
    start: wallSeconds(master.start),
    rules: master.rules.map((r) => ruleInFrame(r, zone, displayZone)),
    exRules: master.exRules.map((r) => ruleInFrame(r, zone, displayZone)),
    rDates: master.rDates.map((v) => keyIn(v, master.start, zones, displayZone)),
    exDates: master.exDates.map((v) => keyIn(v, master.start, zones, displayZone)),
  };
}

export function isRepeating(info: EventInfo): boolean {
  return info.rules.length > 0 || info.rDates.length > 0;
}

export interface Occurrence {
  readonly calendarId: string;
  readonly uid: string;
  /** Which occurrence of a repeating series; null for an event that doesn't repeat. */
  readonly key: number | null;
  /** UTC seconds. An all-day occurrence starts and ends at midnight in the display zone. */
  readonly start: number;
  readonly end: number;
  readonly allDay: boolean;
  /** All-day only: the first day and the day after the last. */
  readonly startDate: PlainDate | null;
  readonly endDate: PlainDate | null;
  /** The event's own TZID when it has one Daybird knows, for "9:00 AM New York" (§4.3). */
  readonly tzid: string | null;
  /** The start on the event's own clock. */
  readonly ownStart: PlainDateTime;
  readonly title: string;
  readonly location: string;
  readonly notes: string;
  readonly url: string;
  readonly reminders: readonly Reminder[];
  /** Part of a repeating series (an override counts). */
  readonly repeating: boolean;
  readonly isOverride: boolean;
  /** The 50,000 cap stopped the expansion (§4.4). */
  readonly capped: boolean;
  readonly problems: readonly string[];
}

interface Context {
  readonly calendarId: string;
  readonly zones: ReadonlyMap<string, Zone>;
  readonly displayZone: string;
}

function occurrence(
  ctx: Context,
  info: EventInfo,
  key: number | null,
  shift: number,
  extra: { repeating: boolean; isOverride: boolean; capped: boolean },
): Occurrence {
  const { zone, unknown } = zoneOf(info.start, ctx.zones);
  const problems = [...info.problems];
  if (unknown) problems.push(`Unknown time zone ${unknown}; shown in local time.`);
  if (extra.capped) problems.push('This event repeats too often to show every time.');
  const startWall = wallSeconds(info.start) + shift;
  const start = toInstant(startWall, zone, ctx.displayZone);
  let end: number;
  let startDate: PlainDate | null = null;
  let endDate: PlainDate | null = null;
  if (info.allDay && info.start.kind === 'date' && info.end.kind === 'date') {
    const days = Math.round((wallSeconds(info.end) - wallSeconds(info.start)) / SECONDS_PER_DAY);
    startDate = addDays(info.start.date, Math.round(shift / SECONDS_PER_DAY));
    endDate = addDays(startDate, days);
    end = toInstant(wallSeconds({ kind: 'date', date: endDate }), FLOATING, ctx.displayZone);
  } else {
    end =
      start +
      (instantOf(info.end, ctx.zones, ctx.displayZone) - instantOf(info.start, ctx.zones, ctx.displayZone));
  }
  return {
    calendarId: ctx.calendarId,
    uid: info.uid,
    key,
    start,
    end: Math.max(end, start),
    allDay: info.allDay,
    startDate,
    endDate,
    tzid: info.start.kind === 'date-time' && info.start.tzid && !unknown ? info.start.tzid : null,
    ownStart: fromLocalSeconds(startWall),
    title: info.title,
    location: info.location,
    notes: info.notes,
    url: info.url,
    reminders: info.reminders,
    ...extra,
    problems,
  };
}

function overlaps(o: Occurrence, from: number, to: number): boolean {
  return o.start === o.end ? o.start >= from && o.start < to : o.start < to && o.end > from;
}

/** A series' occurrences that overlap `[from, to)` (UTC seconds), in start order. */
export function seriesOccurrences(series: EventSeries, ctx: Context, from: number, to: number): Occurrence[] {
  const out: Occurrence[] = [];
  const master = series.master ? readEvent(series.master) : null;
  const overrides = new Map<number, EventInfo>();
  const orphans: EventInfo[] = [];
  for (const o of series.overrides) {
    const info = readEvent(o);
    if (master && info.recurrenceId)
      overrides.set(keyIn(info.recurrenceId, master.start, ctx.zones, ctx.displayZone), info);
    else orphans.push(info);
  }
  if (master && isRepeating(master)) {
    const set = recurrenceSetOf(master, ctx.zones, ctx.displayZone);
    const length = Math.max(
      0,
      wallSeconds(master.end) - wallSeconds(master.start),
      instantOf(master.end, ctx.zones, ctx.displayZone) - instantOf(master.start, ctx.zones, ctx.displayZone),
    );
    const margin = 2 * SECONDS_PER_DAY;
    const { starts, capped } = expandSet(set, from - length - margin, to + margin);
    for (const key of starts) {
      if (overrides.has(key)) continue;
      const o = occurrence(ctx, master, key, key - set.start, { repeating: true, isOverride: false, capped });
      if (overlaps(o, from, to)) out.push(o);
    }
    for (const [key, info] of overrides) {
      const o = occurrence(ctx, info, key, 0, { repeating: true, isOverride: true, capped: false });
      if (overlaps(o, from, to)) out.push(o);
    }
  } else if (master) {
    const o = occurrence(ctx, master, null, 0, { repeating: false, isOverride: false, capped: false });
    if (overlaps(o, from, to)) out.push(o);
    for (const [key, info] of overrides) {
      const oo = occurrence(ctx, info, key, 0, { repeating: true, isOverride: true, capped: false });
      if (overlaps(oo, from, to)) out.push(oo);
    }
  }
  for (const info of orphans) {
    const key = info.recurrenceId ? wallSeconds(info.recurrenceId) : null;
    const o = occurrence(ctx, info, key, 0, {
      repeating: key !== null,
      isOverride: key !== null,
      capped: false,
    });
    if (overlaps(o, from, to)) out.push(o);
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Every occurrence in the calendars that overlaps `[from, to)` (UTC seconds), sorted by start, then all-day
 * first, then longer first, then title.
 */
export function occurrencesIn(
  calendars: readonly Calendar[],
  from: number,
  to: number,
  displayZone: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const calendar of calendars) {
    if (calendar.readOnly) continue;
    const ctx = { calendarId: calendar.id, zones: calendarZones(calendar.document), displayZone };
    for (const series of seriesOf(calendar.document)) out.push(...seriesOccurrences(series, ctx, from, to));
  }
  return out.sort(
    (a, b) =>
      a.start - b.start ||
      Number(b.allDay) - Number(a.allDay) ||
      b.end - b.start - (a.end - a.start) ||
      a.title.localeCompare(b.title),
  );
}

/** One occurrence by key (or the single event when `key` is null), or null when the series has no such one. */
export function findOccurrence(
  calendar: Calendar,
  uid: string,
  key: number | null,
  displayZone: string,
): Occurrence | null {
  const series = seriesOf(calendar.document).find((s) => s.uid === uid);
  if (!series) return null;
  const ctx = { calendarId: calendar.id, zones: calendarZones(calendar.document), displayZone };
  const master = series.master ? readEvent(series.master) : null;
  if (key === null) {
    if (!master) return null;
    const all = seriesOccurrences({ ...series, overrides: [] }, ctx, -1e12, 1e12);
    return all.find((o) => o.key === null) ?? null;
  }
  // Wide enough for any zone offset and an event of up to a year.
  const window = 400 * SECONDS_PER_DAY;
  return seriesOccurrences(series, ctx, key - window, key + window).find((o) => o.key === key) ?? null;
}

/** The VEVENT a key names: its override, else the master. */
export function eventForKey(
  series: EventSeries,
  key: number | null,
  zones: ReadonlyMap<string, Zone>,
  displayZone: string,
): ComponentNode | null {
  if (key === null || !series.master) return series.master ?? series.overrides[0] ?? null;
  const masterStart = readEvent(series.master).start;
  for (const o of series.overrides) {
    const rid = readEvent(o).recurrenceId;
    if (rid && keyIn(rid, masterStart, zones, displayZone) === key) return o;
  }
  return series.master;
}
