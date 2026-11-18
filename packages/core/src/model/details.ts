/** What the event popover shows for one occurrence (PRD §7.2): its times in its own frame, its repeat and problems. */
import type { TimeValue } from '../ical/values.ts';
import { addSeconds, dateOf } from '../time/dateTime.ts';
import type { RecurrenceRule } from '../time/rrule.ts';
import { describeRule } from '../time/ruleWords.ts';
import type { Zone } from '../time/zones.ts';
import { calendarZones, findSeries, type Calendar } from './calendar.ts';
import { readEvent } from './event.ts';
import { eventForKey, findOccurrence, zoneOf, type Occurrence } from './occurrences.ts';

export interface OccurrenceDetails {
  readonly occurrence: Occurrence;
  /** This occurrence's start and end on the event's own clock: a date for all-day, else its zone. */
  readonly start: TimeValue;
  readonly end: TimeValue;
  /** The repeat in words; null when it doesn't repeat. */
  readonly repeat: string | null;
  /** What couldn't be read (§3.2). */
  readonly problems: readonly string[];
  /** The series' rule; null when it doesn't repeat by a rule. */
  readonly rule: RecurrenceRule | null;
  /** True when the repeat is more than one rule, or extra dates: shown in words, never edited (§8.1). */
  readonly complexRepeat: boolean;
  /** The series' first start and its zone: the clock its rule runs on. */
  readonly seriesStart: TimeValue;
  readonly zone: Zone;
  /** The calendar's own zones, for turning its times into instants. */
  readonly zones: ReadonlyMap<string, Zone>;
}

export function occurrenceDetails(
  calendar: Calendar,
  uid: string,
  key: number | null,
  displayZone: string,
): OccurrenceDetails | null {
  const o = findOccurrence(calendar, uid, key, displayZone);
  const series = findSeries(calendar.document, uid);
  const event = series && eventForKey(series, key, calendarZones(calendar.document), displayZone);
  if (!o || !series || !event) return null;
  const info = readEvent(event);
  const master = series.master ? readEvent(series.master) : null;
  const rule = master?.rules[0];
  const repeat = rule
    ? describeRule(rule, dateOf(o.ownStart))
    : master?.rDates.length
      ? 'On set dates'
      : null;
  let start: TimeValue;
  let end: TimeValue;
  if (o.allDay && o.startDate && o.endDate) {
    start = { kind: 'date', date: o.startDate };
    end = { kind: 'date', date: o.endDate };
  } else {
    const frame =
      info.start.kind === 'date-time'
        ? info.start
        : ({ kind: 'date-time', dateTime: o.ownStart, utc: false, tzid: null } as const);
    start = { ...frame, dateTime: o.ownStart };
    end = { ...frame, dateTime: addSeconds(o.ownStart, Math.max(0, o.end - o.start)) };
  }
  const problems = [...info.problems, ...(master && event !== series.master ? master.problems : [])];
  const seriesStart = master?.start ?? info.start;
  return {
    occurrence: o,
    start,
    end,
    repeat,
    problems: [...new Set(problems)],
    rule: rule ?? null,
    complexRepeat: !!master && (master.rules.length > 1 || master.rDates.length > 0),
    seriesStart,
    zone: zoneOf(seriesStart, calendarZones(calendar.document)).zone,
    zones: calendarZones(calendar.document),
  };
}
