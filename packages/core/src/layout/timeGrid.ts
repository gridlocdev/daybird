/**
 * Where events sit in the Day and Week time grid (PRD §6.1): each occurrence cut into one segment per day, in
 * minutes from the display zone's midnight, then each day's segments split into side-by-side columns.
 */
import { addDays, type PlainDate } from '../plainDate.ts';
import { localSecondsOfDate } from '../time/dateTime.ts';
import { FLOATING, toInstant, toLocal } from '../time/zones.ts';

export const MINUTES_PER_DAY = 1440;
/** Events shorter than this draw this tall (§6.1). */
export const MIN_EVENT_MINUTES = 15;

/** A day in the display zone as UTC seconds: its midnight and the next one (23 or 25 hours apart at a change). */
export function dayBounds(date: PlainDate, displayZone: string): { start: number; end: number } {
  return {
    start: toInstant(localSecondsOfDate(date), FLOATING, displayZone),
    end: toInstant(localSecondsOfDate(addDays(date, 1)), FLOATING, displayZone),
  };
}

/** Minutes on the wall clock from `date`'s midnight to the instant `utc`; outside the day it runs past 0–1440. */
export function wallMinutes(utc: number, date: PlainDate, displayZone: string): number {
  return (toLocal(utc, FLOATING, displayZone) - localSecondsOfDate(date)) / 60;
}

export interface Timed {
  /** UTC seconds. */
  readonly start: number;
  readonly end: number;
}

export interface Segment<T> {
  readonly item: T;
  /** Minutes from midnight on the wall clock, as drawn: at least MIN_EVENT_MINUTES apart, inside the day. */
  readonly top: number;
  readonly bottom: number;
  /** The event started on an earlier day, or goes on to a later one: that edge is drawn square (§6.1). */
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
}

/** Each day's segments of `items` (timed occurrences), in the order given. */
export function daySegments<T extends Timed>(
  items: readonly T[],
  days: readonly PlainDate[],
  displayZone: string,
): Segment<T>[][] {
  return days.map((date) => {
    const day = dayBounds(date, displayZone);
    const out: Segment<T>[] = [];
    for (const item of items) {
      const empty = item.end <= item.start;
      // An event touches a day when it overlaps it; one with no length, when it starts in it.
      const inDay = empty
        ? item.start >= day.start && item.start < day.end
        : item.start < day.end && item.end > day.start;
      if (!inDay) continue;
      const continuesBefore = item.start < day.start;
      const continuesAfter = item.end > day.end;
      let top = continuesBefore ? 0 : clamp(wallMinutes(item.start, date, displayZone));
      let bottom = continuesAfter ? MINUTES_PER_DAY : clamp(wallMinutes(item.end, date, displayZone));
      bottom = Math.min(MINUTES_PER_DAY, Math.max(bottom, top + MIN_EVENT_MINUTES));
      top = Math.min(top, bottom - MIN_EVENT_MINUTES);
      out.push({ item, top, bottom, continuesBefore, continuesAfter });
    }
    return out;
  });
}

const clamp = (m: number) => Math.max(0, Math.min(MINUTES_PER_DAY, m));

export interface Placed<T> extends Segment<T> {
  /** The column it starts in, how many it takes, and how many its cluster has. */
  readonly column: number;
  readonly span: number;
  readonly columns: number;
}

const overlaps = (a: { top: number; bottom: number }, b: { top: number; bottom: number }) =>
  a.top < b.bottom && b.top < a.bottom;

/**
 * Splits one day's segments into columns (§6.1): each cluster of overlapping events gets as many columns as its
 * widest moment; events go left-first in start order, longer first on a tie, and each widens right into columns
 * that are free for its whole length.
 */
export function layoutDay<T>(segments: readonly Segment<T>[]): Placed<T>[] {
  const sorted = [...segments].sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  const out: Placed<T>[] = [];
  let cluster: Segment<T>[] = [];
  let clusterEnd = -1;
  const finish = () => {
    if (cluster.length) out.push(...placeCluster(cluster));
    cluster = [];
  };
  for (const s of sorted) {
    if (s.top >= clusterEnd) finish();
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.bottom);
  }
  finish();
  return out;
}

function placeCluster<T>(cluster: readonly Segment<T>[]): Placed<T>[] {
  // Greedy in start order: a column is free when its last event has ended. For intervals this uses exactly as many
  // columns as the most events at one moment.
  const columnEnds: number[] = [];
  const columnOf = cluster.map((s) => {
    let c = columnEnds.findIndex((end) => end <= s.top);
    if (c < 0) c = columnEnds.push(0) - 1;
    columnEnds[c] = s.bottom;
    return c;
  });
  const columns = columnEnds.length;
  return cluster.map((s, i) => {
    const column = columnOf[i]!;
    let span = 1;
    while (
      column + span < columns &&
      !cluster.some((o, j) => columnOf[j] === column + span && overlaps(o, s))
    )
      span++;
    return { ...s, column, span, columns };
  });
}

/** Where the time grid opens (§6.1): 30 minutes before now when today is shown, else the first-hour setting. */
export function openingMinutes(nowMinutes: number | null, firstHour: number): number {
  return nowMinutes === null ? firstHour * 60 : Math.max(0, nowMinutes - 30);
}
