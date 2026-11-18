/**
 * Moving, resizing and copying events (PRD §7.3, §7.5). Times stay wall-clock in the event's own frame, so a move
 * of a New York event in a London window keeps it a New York event.
 */
import { componentNode, propertyNode, writeCalendar } from '../ical/document.ts';
import type { TimeValue } from '../ical/values.ts';
import { withVTimezones } from '../ical/vtimezone.ts';
import { addDays, diffDays, type PlainDate } from '../plainDate.ts';
import { addSeconds, plainDateTime, toLocalSeconds } from '../time/dateTime.ts';
import { isIanaZone } from '../time/zones.ts';
import type { OccurrenceDetails } from './details.ts';
import { newEvent } from './event.ts';
import { SNAP_MINUTES, allDayTimes, timedTimes, withWhen, whenOf } from './eventTimes.ts';
import type { NewEventFields } from './workspace.ts';

type Times = { start: TimeValue; end: TimeValue };

const dateTimeOf = (v: TimeValue): string => (v.kind === 'date-time' ? v.dateTime : plainDateTime(v.date));
const lengthSeconds = (t: Times): number =>
  toLocalSeconds(dateTimeOf(t.end)) - toLocalSeconds(dateTimeOf(t.start));

/** Where a dragged event lands: a time on a day (timed), or a day (all-day). */
export type MoveTarget =
  | { readonly kind: 'time'; readonly date: PlainDate; readonly minute: number }
  | { readonly kind: 'day'; readonly date: PlainDate };

/**
 * The times after a drop on `target`. Timed to timed keeps the length; all-day to all-day keeps the days. An
 * all-day event dropped on the grid becomes `lengthMinutes` long, and a timed one dropped in the all-day strip
 * becomes a one-day event (§7.3).
 */
export function movedTimes(t: Times, target: MoveTarget, zone: string, lengthMinutes: number): Times {
  if (target.kind === 'day') {
    if (t.start.kind !== 'date') return allDayTimes(target.date, target.date);
    const days = Math.max(1, t.end.kind === 'date' ? diffDays(t.start.date, t.end.date) : 1);
    return allDayTimes(target.date, addDays(target.date, days - 1));
  }
  const at = addSeconds(plainDateTime(target.date), target.minute * 60);
  if (t.start.kind === 'date')
    return timedTimes(target.date, target.minute, target.minute + lengthMinutes, zone);
  const start = { ...t.start, dateTime: at };
  const end = t.end.kind === 'date-time' ? t.end : start;
  return { start, end: { ...end, dateTime: addSeconds(at, lengthSeconds(t)) } };
}

/** The times moved by whole days and minutes, keeping the length. All-day events move by days only. */
export function shiftedTimes(t: Times, by: { readonly days?: number; readonly minutes?: number }): Times {
  const days = by.days ?? 0;
  const seconds = days * 86400 + (by.minutes ?? 0) * 60;
  const shift = (v: TimeValue): TimeValue =>
    v.kind === 'date'
      ? { ...v, date: addDays(v.date, days) }
      : { ...v, dateTime: addSeconds(v.dateTime, seconds) };
  return { start: shift(t.start), end: shift(t.end) };
}

/** A new end at `minute` on `date`, at least the snap after the start (dragging the bottom edge, §7.3). */
export function withEndAt(t: Times, date: PlainDate, minute: number, zone: string): Times {
  if (t.start.kind === 'date') return t;
  return withWhen(t.start, t.end, { endDate: date, endMinute: minute }, zone, SNAP_MINUTES);
}

/** A new start at `minute` on `date` that keeps the end, at least the snap before it (Shift-drag the top edge). */
export function withStartAt(t: Times, date: PlainDate, minute: number): Times {
  if (t.start.kind !== 'date-time') return t;
  const latest = toLocalSeconds(dateTimeOf(t.end)) - SNAP_MINUTES * 60;
  const wanted = addSeconds(plainDateTime(date), minute * 60);
  const dateTime =
    toLocalSeconds(wanted) <= latest ? wanted : addSeconds(dateTimeOf(t.end), -SNAP_MINUTES * 60);
  return { start: { ...t.start, dateTime }, end: t.end };
}

/** Whether two sets of times are the same, so a drop where it started changes nothing. */
export function sameTimes(a: Times, b: Times): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The fields to make a copy of an occurrence as a single event (§7.5): no repeat, its own times. */
export function copyFields(d: OccurrenceDetails): NewEventFields {
  const o = d.occurrence;
  return {
    title: o.title,
    location: o.location,
    notes: o.notes,
    url: o.url,
    reminders: o.reminders,
    start: d.start,
    end: d.end,
  };
}

/** A copy's times: the same clock time on `date` (pasting, duplicating), keeping the length and frame. */
export function onDate(t: Times, date: PlainDate): Times {
  const from = whenOf(t.start, t.end).startDate;
  return shiftedTimes(t, { days: diffDays(from, date) });
}

/** One event as an iCalendar file, for the system clipboard (§7.5). */
export function eventAsText(fields: NewEventFields, uid: string, now: number): string {
  const event = newEvent(uid, fields, now);
  const tzids = [fields.start, fields.end].flatMap((v) =>
    v.kind === 'date-time' && v.tzid && isIanaZone(v.tzid) ? [v.tzid] : [],
  );
  const calendar = componentNode('VCALENDAR', [
    propertyNode('VERSION', '2.0'),
    propertyNode('PRODID', '-//Daybird//Daybird//EN'),
    event,
  ]);
  return writeCalendar(withVTimezones(calendar, tzids, new Date(now * 1000).getUTCFullYear()));
}
