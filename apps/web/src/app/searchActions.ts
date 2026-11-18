/** Search (PRD §10): the field's text, its results and what Enter and Escape do. */
import { batch } from '@preact/signals';
import {
  agendaDays,
  dayBounds,
  addDays,
  matchesSearch,
  nearestFirst,
  searchRange,
  type AgendaDay,
  type Occurrence,
} from '@daybird/core';
import type { AppController } from './controller.ts';

/** The most results listed; typing more narrows them. */
export const MAX_RESULTS = 300;

export const SEARCH_FIELD_ID = 'db-search';

/** The matching days, nearest to today first, and whether more matched than are listed. */
export function searchDays(app: AppController): { days: AgendaDay<Occurrence>[]; more: boolean } {
  const query = app.search.value;
  const range = searchRange(app.today.value);
  const from = dayBounds(range.start, app.displayZone).start;
  const to = dayBounds(addDays(range.end, -1), app.displayZone).end;
  const found = app.occurrencesBetween(from, to).filter((o) => matchesSearch(o, query));
  const days = nearestFirst(agendaDays(found, range, app.displayZone), app.today.value);
  const out: AgendaDay<Occurrence>[] = [];
  let listed = 0;
  for (const d of days) {
    if (listed >= MAX_RESULTS) return { days: out, more: true };
    out.push(d);
    listed += d.items.length;
  }
  return { days: out, more: false };
}

/** ⌘F and /: the search field takes focus, its text selected. */
export function focusSearch(): void {
  const field = document.getElementById(SEARCH_FIELD_ID);
  if (field instanceof HTMLInputElement) {
    field.focus();
    field.select();
  }
}

/** Escape: the text goes and the view comes back. */
export function clearSearch(app: AppController): void {
  app.search.value = '';
}

/** Enter: the first result in Day view, selected, and the search cleared. */
export function showFirstResult(app: AppController): void {
  const first = searchDays(app).days[0];
  const o = first?.items[0];
  if (!first || !o) return;
  batch(() => {
    app.search.value = '';
    app.openDay(first.date);
    app.select({ calendarId: o.calendarId, uid: o.uid, key: o.key });
  });
}
