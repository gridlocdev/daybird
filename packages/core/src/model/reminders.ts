/**
 * Reminders (PRD §9): the popover's choices and their words, and which reminders fall due in a stretch of time.
 * A reminder before an all-day event counts from midnight at the start of its first day in the display zone.
 */
import { SECONDS_PER_DAY } from '../time/dateTime.ts';
import type { Reminder } from './event.ts';
import { instantOf, type Occurrence } from './occurrences.ts';

/** The most reminders the popover gives an event (§9). */
export const MAX_REMINDERS = 5;

const MINUTE = 60;
const HOUR = 3600;
const WEEK = 7 * SECONDS_PER_DAY;
/** All-day reminders ring at 9:00 on the clock of the display zone. */
const NINE = 9 * HOUR;

const before = (seconds: number): Reminder => ({ kind: 'before', seconds });

/** The popover's Reminder menu, without Custom… (§9). */
export function reminderChoices(allDay: boolean): readonly Reminder[] {
  if (allDay) return [before(-NINE), before(SECONDS_PER_DAY - NINE), before(WEEK - NINE)];
  return [0, 5, 10, 15, 30, 60, 120, 24 * 60, 48 * 60, 7 * 24 * 60].map((m) => before(m * MINUTE));
}

/** The reminder an event gets when Add Reminder is chosen: 10 minutes before, or 9:00 on the day. */
export function firstReminder(allDay: boolean): Reminder {
  return allDay ? before(-NINE) : before(10 * MINUTE);
}

export type ReminderUnit = 'minutes' | 'hours' | 'days' | 'weeks';
const UNIT_SECONDS: Record<ReminderUnit, number> = {
  minutes: MINUTE,
  hours: HOUR,
  days: SECONDS_PER_DAY,
  weeks: WEEK,
};

/** The largest unit that divides `seconds` (taken as positive), and how many of it. */
export function reminderAmount(seconds: number): { readonly amount: number; readonly unit: ReminderUnit } {
  const s = Math.abs(seconds);
  for (const unit of ['weeks', 'days', 'hours'] as const)
    if (s > 0 && s % UNIT_SECONDS[unit] === 0) return { amount: s / UNIT_SECONDS[unit], unit };
  return { amount: Math.round(s / MINUTE), unit: 'minutes' };
}

/** A Custom… reminder: `amount` units before the start. */
export function customReminder(amount: number, unit: ReminderUnit): Reminder {
  return before(Math.max(0, Math.round(amount)) * UNIT_SECONDS[unit]);
}

function amountWords(seconds: number): string {
  const { amount, unit } = reminderAmount(seconds);
  return `${amount} ${amount === 1 ? unit.slice(0, -1) : unit}`;
}

/** How the words show times: a date and time for a reminder at a set instant, and 9:00 in the user's format. */
export interface ReminderFormat {
  readonly dateTime: (utcSeconds: number) => string;
  readonly nine: string;
}

/** "10 minutes before", "The day before at 9:00 AM", "At time of event". */
export function reminderWords(r: Reminder, allDay: boolean, format: ReminderFormat): string {
  if (r.kind === 'at') return `On ${format.dateTime(instantOf(r.utc, new Map(), 'UTC'))}`;
  const edge = r.fromEnd ? 'the end' : 'the start';
  if (allDay && !r.fromEnd && (r.seconds + NINE) % SECONDS_PER_DAY === 0) {
    const days = (r.seconds + NINE) / SECONDS_PER_DAY;
    const nine = format.nine;
    if (days === 0) return `On the day at ${nine}`;
    if (days === 1) return `The day before at ${nine}`;
    if (days === 7) return `A week before at ${nine}`;
    if (days > 0) return `${days} days before at ${nine}`;
  }
  if (r.seconds === 0) return r.fromEnd ? 'At the end' : 'At time of event';
  const words = amountWords(r.seconds);
  if (r.seconds < 0) return `${words} after ${edge}`;
  return r.fromEnd ? `${words} before the end` : `${words} before`;
}

/** One reminder of one occurrence, at the instant it rings. */
export interface DueReminder {
  /** Names the reminder and when it rings, so a moved event's reminder rings again. */
  readonly id: string;
  /** UTC seconds. */
  readonly at: number;
  readonly occurrence: Occurrence;
}

/** How far before its event a reminder is looked for; one set further ahead isn't rung (§9). */
export const REMINDER_LEAD_SECONDS = 60 * SECONDS_PER_DAY;
/** How far after its event's start a reminder is looked for (all-day 9:00, "after the start"). */
export const REMINDER_LAG_SECONDS = 2 * SECONDS_PER_DAY;

/** When a reminder of an occurrence rings, in UTC seconds. */
export function reminderInstant(r: Reminder, o: Occurrence): number {
  if (r.kind === 'at') return instantOf(r.utc, new Map(), 'UTC');
  return (r.fromEnd ? o.end : o.start) - r.seconds;
}

/**
 * The reminders that ring in `(after, until]` (UTC seconds), in order. `occurrences` should cover
 * `[after - REMINDER_LAG_SECONDS, until + REMINDER_LEAD_SECONDS)`.
 */
export function remindersDue(
  occurrences: readonly Occurrence[],
  after: number,
  until: number,
): DueReminder[] {
  const out: DueReminder[] = [];
  for (const o of occurrences)
    for (const r of o.reminders) {
      const at = reminderInstant(r, o);
      if (at > after && at <= until)
        out.push({ id: `${o.calendarId}|${o.uid}|${o.key ?? ''}|${at}`, at, occurrence: o });
    }
  return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
