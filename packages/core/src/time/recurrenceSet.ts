/**
 * A recurrence set (RFC 5545 §3.8.5, PRD §4.4): DTSTART, every RRULE and RDATE, less every EXRULE and EXDATE,
 * on the wall clock in local seconds. The caller turns the starts into instants in the event's zone.
 */
import { EXPANSION_CAP, expandRule, type RecurrenceRule } from './rrule.ts';

export interface RecurrenceSet {
  /** DTSTART, local seconds. */
  readonly start: number;
  readonly rules: readonly RecurrenceRule[];
  readonly exRules: readonly RecurrenceRule[];
  /** Local seconds. */
  readonly rDates: readonly number[];
  readonly exDates: readonly number[];
  /** UNTIL in local seconds, when the rule's UNTIL is UTC and the caller has turned it into the event's zone. */
  readonly untilLocal?: number;
}

export interface SetExpansion {
  /** Sorted, without repeats. */
  readonly starts: number[];
  /** True when the 50,000 cap stopped the expansion (PRD §4.4). */
  readonly capped: boolean;
}

/** The starts in `[from, to)`, local seconds. With no rules, DTSTART and the RDATEs alone. */
export function expandSet(set: RecurrenceSet, from: number, to: number, cap = EXPANSION_CAP): SetExpansion {
  const found = new Set<number>();
  let capped = false;
  const options = { from, to, cap, ...(set.untilLocal === undefined ? {} : { untilLocal: set.untilLocal }) };
  if (set.rules.length === 0) {
    if (set.start >= from && set.start < to) found.add(set.start);
  }
  for (const r of set.rules) {
    const e = expandRule(r, set.start, options);
    capped ||= e.capped;
    for (const s of e.starts) found.add(s);
  }
  for (const d of set.rDates) if (d >= from && d < to) found.add(d);
  for (const d of set.exDates) found.delete(d);
  for (const r of set.exRules) {
    const e = expandRule(r, set.start, { from, to, cap });
    capped ||= e.capped;
    for (const s of e.starts) found.delete(s);
  }
  return { starts: [...found].sort((a, b) => a - b), capped };
}

/** Whether `local` is one of the set's starts (a RECURRENCE-ID check, PRD §4.2). */
export function isInSet(set: RecurrenceSet, local: number): boolean {
  return expandSet(set, local, local + 1).starts.includes(local);
}
