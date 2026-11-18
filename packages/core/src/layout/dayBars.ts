/**
 * Bars that span days, in rows (PRD §6.1 all-day strip, §6.2 month weeks): each bar takes the lowest row that is
 * free on every day it covers.
 */
import { diffDays, type PlainDate } from '../plainDate.ts';

export interface DaySpan {
  /** The first day and the day after the last. */
  readonly startDate: PlainDate;
  readonly endDate: PlainDate;
}

export interface Bar<T> {
  readonly item: T;
  /** The first and last day it covers in the row of days, by index. */
  readonly first: number;
  readonly last: number;
  readonly row: number;
  /** It began before the first day shown, or goes on after the last: that end is drawn square. */
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
}

/**
 * Lays out the items that touch `days` (consecutive dates), earliest first and longer first on a tie. An item
 * whose end is not after its start covers its first day.
 */
export function dayBars<T extends DaySpan>(items: readonly T[], days: readonly PlainDate[]): Bar<T>[] {
  if (!days.length) return [];
  const first = days[0]!;
  const count = days.length;
  const spans = items
    .map((item) => {
      const from = diffDays(first, item.startDate);
      const to = Math.max(from, diffDays(first, item.endDate) - 1);
      return { item, from, to };
    })
    .filter((s) => s.to >= 0 && s.from < count)
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const rows: boolean[][] = [];
  return spans.map(({ item, from, to }) => {
    const a = Math.max(0, from);
    const b = Math.min(count - 1, to);
    let row = rows.findIndex((r) => r.slice(a, b + 1).every((taken) => !taken));
    if (row < 0) row = rows.push(Array<boolean>(count).fill(false)) - 1;
    for (let d = a; d <= b; d++) rows[row]![d] = true;
    return { item, first: a, last: b, row, continuesBefore: from < 0, continuesAfter: to >= count };
  });
}

/** How many rows the bars take. */
export function rowCount(bars: readonly Bar<unknown>[]): number {
  return bars.reduce((n, b) => Math.max(n, b.row + 1), 0);
}
