/**
 * The times of new events and the popover's date and time fields (PRD §7.1, §7.2). Times are wall-clock in the
 * event's own frame: a date for all-day, else a date-time in its zone. New events use the display zone (§4.3).
 */
import type { TimeValue } from '../ical/values.ts';
import { addDays, diffDays, fromEpochDay, type PlainDate } from '../plainDate.ts';
import {
  SECONDS_PER_DAY,
  addSeconds,
  dateOf,
  plainDateTime,
  timeOf,
  toLocalSeconds,
} from '../time/dateTime.ts';
import { FLOATING, toLocal } from '../time/zones.ts';

/** Dragging and moving snap to this many minutes (§7.1, §7.3). */
export const SNAP_MINUTES = 15;

/** Rounds down to the snap. */
export function snapDown(minutes: number, step = SNAP_MINUTES): number {
  return Math.floor(minutes / step) * step;
}

/** A date-time in `zone`: UTC as `Z`, any other zone by TZID. */
export function zoneDateTime(dateTime: string, zone: string): TimeValue {
  return zone === 'UTC' || zone === 'Etc/UTC'
    ? { kind: 'date-time', dateTime, utc: true, tzid: null }
    : { kind: 'date-time', dateTime, utc: false, tzid: zone };
}

/** A timed event on `date` from `startMinute` to `endMinute` (past 1440 runs into the next day). */
export function timedTimes(
  date: PlainDate,
  startMinute: number,
  endMinute: number,
  zone: string,
): { start: TimeValue; end: TimeValue } {
  const at = (m: number) => zoneDateTime(addSeconds(plainDateTime(date), m * 60), zone);
  return { start: at(startMinute), end: at(Math.max(endMinute, startMinute + SNAP_MINUTES)) };
}

/** An all-day event from `first` to `last`, both included, in either order. */
export function allDayTimes(first: PlainDate, last: PlainDate): { start: TimeValue; end: TimeValue } {
  const [a, b] = first <= last ? [first, last] : [last, first];
  return { start: { kind: 'date', date: a }, end: { kind: 'date', date: addDays(b, 1) } };
}

/** The next half hour after `utc` (seconds) in `zone`: ⌘N's start (§7.1). */
export function nextHalfHour(utc: number, zone: string): { date: PlainDate; minute: number } {
  const local = toLocal(utc, FLOATING, zone);
  const day = Math.floor(local / SECONDS_PER_DAY);
  const minute = Math.floor((local - day * SECONDS_PER_DAY) / 60 / 30) * 30 + 30;
  const date = fromEpochDay(day);
  return minute >= 1440 ? { date: addDays(date, 1), minute: 0 } : { date, minute };
}

/** What the popover's date and time fields show. `endDate` is the last day for all-day, so it reads naturally. */
export interface WhenFields {
  readonly allDay: boolean;
  readonly startDate: PlainDate;
  /** Minutes after midnight; 0 for all-day. */
  readonly startMinute: number;
  readonly endDate: PlainDate;
  readonly endMinute: number;
}

const partsOf = (v: TimeValue): { date: PlainDate; minute: number } => {
  if (v.kind === 'date') return { date: v.date, minute: 0 };
  const t = timeOf(v.dateTime);
  return { date: dateOf(v.dateTime), minute: t.hour * 60 + t.minute };
};

export function whenOf(start: TimeValue, end: TimeValue): WhenFields {
  const s = partsOf(start);
  const e = partsOf(end);
  if (start.kind === 'date') {
    const last = end.kind === 'date' && end.date > start.date ? addDays(end.date, -1) : start.date;
    return { allDay: true, startDate: s.date, startMinute: 0, endDate: last, endMinute: 0 };
  }
  return { allDay: false, startDate: s.date, startMinute: s.minute, endDate: e.date, endMinute: e.minute };
}

/** The frame a timed value keeps: its own zone, or `zone` for one that was a date. */
function timedIn(old: TimeValue, date: PlainDate, minute: number, zone: string): TimeValue {
  const dateTime = addSeconds(plainDateTime(date), minute * 60);
  return old.kind === 'date-time' ? { ...old, dateTime } : zoneDateTime(dateTime, zone);
}

/**
 * The start and end after the popover changes some fields. A new start keeps the length; an end before the start
 * moves to keep at least the snap (a day for all-day). Turning all-day on keeps the days; turning it off makes a
 * `lengthMinutes` event at 9:00 on the first day, in `zone`.
 */
export function withWhen(
  start: TimeValue,
  end: TimeValue,
  change: Partial<WhenFields>,
  zone: string,
  lengthMinutes: number,
): { start: TimeValue; end: TimeValue } {
  const was = whenOf(start, end);
  const next = { ...was, ...change };
  if (next.allDay !== was.allDay) {
    if (next.allDay)
      return allDayTimes(next.startDate, next.endDate < next.startDate ? next.startDate : next.endDate);
    const s = timedIn(start, next.startDate, 9 * 60, zone);
    return { start: s, end: timedIn(s, next.startDate, 9 * 60 + lengthMinutes, zone) };
  }
  if (next.allDay) {
    const length = diffDays(was.startDate, was.endDate);
    const moved = change.startDate !== undefined && change.endDate === undefined;
    const last = moved ? addDays(next.startDate, length) : next.endDate;
    return allDayTimes(next.startDate, last < next.startDate ? next.startDate : last);
  }
  const s = timedIn(start, next.startDate, next.startMinute, zone);
  const startMoved = change.startDate !== undefined || change.startMinute !== undefined;
  const endChanged = change.endDate !== undefined || change.endMinute !== undefined;
  const after = (seconds: number) => withDateTime(end, s, addSeconds(dt(s), seconds));
  if (startMoved && !endChanged) return { start: s, end: after(wall(end) - wall(start)) };
  const e = timedIn(end, next.endDate, next.endMinute, zone);
  return { start: s, end: wall(e) > wall(s) ? e : after(SNAP_MINUTES * 60) };
}

const dt = (v: TimeValue): string => (v.kind === 'date-time' ? v.dateTime : plainDateTime(v.date));
const wall = (v: TimeValue): number => toLocalSeconds(dt(v));
/** `dateTime` in the frame of `end`, or of `start` when the end was a date. */
const withDateTime = (end: TimeValue, start: TimeValue, dateTime: string): TimeValue =>
  end.kind === 'date-time'
    ? { ...end, dateTime }
    : { ...(start as Extract<TimeValue, { kind: 'date-time' }>), dateTime };
