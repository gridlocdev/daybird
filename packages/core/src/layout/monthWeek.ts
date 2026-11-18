/**
 * One week row of the Month view (PRD §6.2): all-day and multi-day events as bars across their days, the rest
 * as one-line entries in the free lanes of their day, and "N more" where a day has more than fits.
 */
import { addDays, fromEpochDay, type PlainDate } from '../plainDate.ts';
import { SECONDS_PER_DAY } from '../time/dateTime.ts';
import { FLOATING, toLocal } from '../time/zones.ts';
import { dayBars, type Bar, type DaySpan } from './dayBars.ts';
import type { Timed } from './timeGrid.ts';

export interface MonthItem extends Timed {
  readonly allDay: boolean;
  /** All-day only: the first day and the day after the last. */
  readonly startDate: PlainDate | null;
  readonly endDate: PlainDate | null;
}

/** The date an instant falls on in the display zone. */
export function dateAt(utc: number, displayZone: string): PlainDate {
  return fromEpochDay(Math.floor(toLocal(utc, FLOATING, displayZone) / SECONDS_PER_DAY));
}

/** The days an occurrence covers in the display zone: its first day and the day after its last. */
export function daysCovered(item: MonthItem, displayZone: string): DaySpan {
  if (item.allDay && item.startDate && item.endDate)
    return { startDate: item.startDate, endDate: item.endDate };
  const startDate = dateAt(item.start, displayZone);
  // An event ending at midnight doesn't reach into the next day.
  const last = item.end > item.start ? dateAt(item.end - 1, displayZone) : startDate;
  return { startDate, endDate: addDays(last, 1) };
}

export interface MonthLine<T> {
  readonly item: T;
  readonly day: number;
  readonly lane: number;
}

export interface MonthMore {
  readonly day: number;
  readonly lane: number;
  /** How many of the day's events don't show. */
  readonly count: number;
}

export interface MonthWeek<T> {
  /** Bars that show, `row` being their lane. */
  readonly bars: Bar<T>[];
  readonly lines: MonthLine<T>[];
  readonly more: MonthMore[];
  /** Everything on each day, all-day and multi-day first, then by start: the "N more" list. */
  readonly days: T[][];
}

/**
 * Lays out a week of `items` in cells `lanes` lines tall. A day with more than fits keeps its last lane for
 * "N more"; a bar shows only where every day it crosses has room for its lane, so nothing is cut short silently.
 */
export function layoutMonthWeek<T extends MonthItem>(
  items: readonly T[],
  days: readonly PlainDate[],
  displayZone: string,
  lanes: number,
): MonthWeek<T> {
  const spans = items.map((item) => ({ item, ...daysCovered(item, displayZone) }));
  const multi = spans.filter((s) => s.item.allDay || addDays(s.startDate, 1) < s.endDate);
  const single = new Set(spans.filter((s) => !multi.includes(s)));
  const allBars = dayBars(multi, days).map((b) => ({ ...b, item: b.item.item }));
  const linesPerDay = days.map((d) =>
    [...single].filter((s) => s.startDate === d).sort((a, b) => a.item.start - b.item.start),
  );
  const capacity = Math.max(1, lanes);
  const limit = days.map(() => capacity);
  let shownBars: Bar<T>[] = [];
  let lines: MonthLine<T>[] = [];
  let hidden: number[] = [];
  for (let changed = true; changed;) {
    changed = false;
    shownBars = allBars.filter((b) => b.row < Math.min(...limit.slice(b.first, b.last + 1)));
    lines = [];
    hidden = days.map((_, d) => {
      const taken = new Set(shownBars.filter((b) => b.first <= d && b.last >= d).map((b) => b.row));
      const covering = allBars.filter((b) => b.first <= d && b.last >= d).length;
      let lane = 0;
      let placed = 0;
      for (const s of linesPerDay[d]!) {
        while (taken.has(lane)) lane++;
        if (lane >= limit[d]!) break;
        lines.push({ item: s.item, day: d, lane });
        lane++;
        placed++;
      }
      return covering - taken.size + (linesPerDay[d]!.length - placed);
    });
    hidden.forEach((n, d) => {
      if (n > 0 && limit[d] === capacity) {
        limit[d] = capacity - 1;
        changed = true;
      }
    });
  }
  const more = hidden.flatMap((count, day) => (count > 0 ? [{ day, lane: limit[day]!, count }] : []));
  const perDay = days.map((_, d) => [
    ...allBars.filter((b) => b.first <= d && b.last >= d).map((b) => b.item),
    ...linesPerDay[d]!.map((s) => s.item),
  ]);
  return { bars: shownBars, lines, more, days: perDay };
}

/** Everything on `date`, all-day and multi-day first, then by start: the list behind "N more" (§6.2). */
export function itemsOnDay<T extends MonthItem>(
  items: readonly T[],
  date: PlainDate,
  displayZone: string,
): T[] {
  return layoutMonthWeek(items, [date], displayZone, 1).days[0]!;
}
