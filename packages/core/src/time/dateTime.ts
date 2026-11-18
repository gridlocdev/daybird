/**
 * Wall-clock date-times without a zone (PRD §4.1). A `PlainDateTime` is `YYYY-MM-DDTHH:MM:SS`; arithmetic is
 * on "local seconds", whole seconds since 1970-01-01T00:00:00 on the same wall clock, so it never passes
 * through `Date` in the system's zone.
 */
import { fromEpochDay, parsePlainDate, toEpochDay, type PlainDate } from '../plainDate.ts';

/** `YYYY-MM-DDTHH:MM:SS`. */
export type PlainDateTime = string;

export const SECONDS_PER_DAY = 86_400;

const PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

export interface TimeParts {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function plainDateTime(date: PlainDate, hour = 0, minute = 0, second = 0): PlainDateTime {
  return `${date}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

export function isPlainDateTime(text: unknown): text is PlainDateTime {
  if (typeof text !== 'string') return false;
  const m = PATTERN.exec(text);
  return (
    !!m && parsePlainDate(m[1] ?? '') !== null && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4]) < 61
  );
}

/** Seconds since 1970-01-01T00:00:00 on the same wall clock. A leap second (:60) reads as :59. */
export function toLocalSeconds(dateTime: PlainDateTime): number {
  const m = PATTERN.exec(dateTime);
  if (!m || !isPlainDateTime(dateTime)) throw new RangeError(`Not a date-time: ${dateTime}`);
  return (
    toEpochDay(m[1] ?? '') * SECONDS_PER_DAY +
    Number(m[2]) * 3600 +
    Number(m[3]) * 60 +
    Math.min(59, Number(m[4]))
  );
}

export function fromLocalSeconds(seconds: number): PlainDateTime {
  const day = Math.floor(seconds / SECONDS_PER_DAY);
  const rest = seconds - day * SECONDS_PER_DAY;
  return plainDateTime(fromEpochDay(day), Math.floor(rest / 3600), Math.floor((rest % 3600) / 60), rest % 60);
}

export function dateOf(dateTime: PlainDateTime): PlainDate {
  return dateTime.slice(0, 10);
}

export function timeOf(dateTime: PlainDateTime): TimeParts {
  const s = toLocalSeconds(dateTime) - toEpochDay(dateOf(dateTime)) * SECONDS_PER_DAY;
  return { hour: Math.floor(s / 3600), minute: Math.floor((s % 3600) / 60), second: s % 60 };
}

export function addSeconds(dateTime: PlainDateTime, seconds: number): PlainDateTime {
  return fromLocalSeconds(toLocalSeconds(dateTime) + seconds);
}

/** A date at midnight. */
export function startOfDay(date: PlainDate): PlainDateTime {
  return plainDateTime(date);
}

export function localSecondsOfDate(date: PlainDate): number {
  return toEpochDay(date) * SECONDS_PER_DAY;
}
