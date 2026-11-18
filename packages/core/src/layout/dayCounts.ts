/** How busy each day is: the mini month's dots (PRD §5.2) and the Year view's tints (§6.3). */
import { addDays, type PlainDate } from '../plainDate.ts';
import type { DateRange } from '../views.ts';
import { daysCovered, type MonthItem } from './monthWeek.ts';

/** How many of `items` fall on each day of `range` in the display zone; days with none are left out. */
export function countsByDay(
  items: readonly MonthItem[],
  range: DateRange,
  displayZone: string,
): Map<PlainDate, number> {
  const counts = new Map<PlainDate, number>();
  for (const item of items) {
    const span = daysCovered(item, displayZone);
    const from = span.startDate < range.start ? range.start : span.startDate;
    const to = span.endDate > range.end ? range.end : span.endDate;
    for (let d = from; d < to; d = addDays(d, 1)) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return counts;
}

/** The Year view's tint for a day with `count` events: 0 for none, then 1–2, 3–5 and 6 or more (§6.3). */
export function busyLevel(count: number): 0 | 1 | 2 | 3 {
  return count <= 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : 3;
}
