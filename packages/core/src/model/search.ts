/**
 * Search (PRD §10): occurrences whose title, location or notes hold the typed text, ignoring case and accents,
 * from a year back to two years ahead.
 */
import { addDays, addMonths, type PlainDate } from '../plainDate.ts';
import type { DateRange } from '../views.ts';

/** Text folded for matching: lower case, accents dropped, runs of space as one. */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

interface Searchable {
  readonly title: string;
  readonly location: string;
  readonly notes: string;
}

/** Whether `item` holds every word of `query`, in its title, location or notes. An empty query matches nothing. */
export function matchesSearch(item: Searchable, query: string): boolean {
  const words = searchKey(query).split(' ').filter(Boolean);
  if (!words.length) return false;
  const text = searchKey(`${item.title}\n${item.location}\n${item.notes}`);
  return words.every((w) => text.includes(w));
}

/** The days search looks through: a year before `today` to two years after. */
export function searchRange(today: PlainDate): DateRange {
  return { start: addMonths(today, -12), end: addDays(addMonths(today, 24), 1) };
}

/**
 * Days in the order search lists them, nearest to `today` first: today and the days after it, then the days
 * before it, latest first.
 */
export function nearestFirst<T extends { readonly date: PlainDate }>(
  days: readonly T[],
  today: PlainDate,
): T[] {
  const coming = days.filter((d) => d.date >= today);
  const past = days.filter((d) => d.date < today).reverse();
  return [...coming, ...past];
}
