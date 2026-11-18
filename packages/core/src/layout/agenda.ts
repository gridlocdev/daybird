/** The Agenda list (PRD §6.4): occurrences grouped by the days they touch, empty days left out. */
import { addDays, type PlainDate } from '../plainDate.ts';
import type { DateRange } from '../views.ts';
import { daysCovered, type MonthItem } from './monthWeek.ts';

export interface AgendaDay<T> {
  readonly date: PlainDate;
  /** All-day and multi-day events first, then by start. */
  readonly items: T[];
}

/** Each day of `range` that has events, in order, with every event that touches it in the display zone. */
export function agendaDays<T extends MonthItem>(
  items: readonly T[],
  range: DateRange,
  displayZone: string,
): AgendaDay<T>[] {
  const byDay = new Map<PlainDate, { item: T; spans: boolean }[]>();
  for (const item of items) {
    const span = daysCovered(item, displayZone);
    const spans = item.allDay || addDays(span.startDate, 1) < span.endDate;
    const from = span.startDate < range.start ? range.start : span.startDate;
    for (let d = from; d < span.endDate && d < range.end; d = addDays(d, 1)) {
      const list = byDay.get(d) ?? [];
      list.push({ item, spans });
      byDay.set(d, list);
    }
  }
  return [...byDay.keys()].sort().map((date) => ({
    date,
    items: byDay
      .get(date)!
      .sort((a, b) => Number(b.spans) - Number(a.spans) || a.item.start - b.item.start)
      .map((e) => e.item),
  }));
}
