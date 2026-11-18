/**
 * VTIMEZONE components (PRD §3.3, §4.3): read into zones the engine can use, and written for IANA zones a
 * file uses but doesn't define, from the offsets `Intl` reports across a year.
 */
import { addDays, daysInMonth, plainDate, toEpochDay, weekday as weekdayOf } from '../plainDate.ts';
import { SECONDS_PER_DAY, fromLocalSeconds, toLocalSeconds } from '../time/dateTime.ts';
import { WEEKDAY_CODES, formatRule, parseRule, rule } from '../time/rrule.ts';
import {
  formatOffset,
  offsetAt,
  parseOffset,
  transitionsIn,
  zoneAbbreviation,
  type Observance,
  type Zone,
} from '../time/zones.ts';
import { unescapeText } from './contentLine.ts';
import {
  componentNode,
  components,
  properties,
  property,
  propertyNode,
  withChildren,
  type CalendarNode,
  type ComponentNode,
} from './document.ts';
import { parseTimeText } from './values.ts';

/** A zone from a VTIMEZONE, or null when it has no usable STANDARD or DAYLIGHT part. */
export function readVTimezone(component: ComponentNode): Zone | null {
  const id = property(component, 'TZID')?.value.trim();
  if (!id) return null;
  const observances: Observance[] = [];
  for (const part of component.children) {
    if (part.kind !== 'component' || (part.name !== 'STANDARD' && part.name !== 'DAYLIGHT')) continue;
    const start = parseTimeText(property(part, 'DTSTART')?.value ?? '', null);
    const from = parseOffset(property(part, 'TZOFFSETFROM')?.value ?? '');
    const to = parseOffset(property(part, 'TZOFFSETTO')?.value ?? '');
    if (!start || start.kind !== 'date-time' || from === null || to === null) continue;
    const ruleLine = property(part, 'RRULE');
    const parsed = ruleLine ? parseRule(ruleLine.value) : null;
    const rdates: number[] = [];
    for (const r of properties(part, 'RDATE')) {
      for (const item of r.value.split(',')) {
        const v = parseTimeText(item.split('/')[0] ?? '', null);
        if (v?.kind === 'date-time') rdates.push(toLocalSeconds(v.dateTime));
      }
    }
    const name = property(part, 'TZNAME');
    observances.push({
      kind: part.name,
      start: toLocalSeconds(start.dateTime),
      offsetFrom: from,
      offsetTo: to,
      rule: parsed?.ok ? parsed.rule : null,
      rdates,
      name: name ? unescapeText(name.value) : null,
    });
  }
  return observances.length ? { kind: 'custom', id, observances } : null;
}

/** The zones a file defines, by TZID. */
export function fileZones(calendar: ComponentNode): Map<string, Zone> {
  const zones = new Map<string, Zone>();
  for (const c of components(calendar, 'VTIMEZONE')) {
    const zone = readVTimezone(c);
    if (zone?.kind === 'custom') zones.set(zone.id, zone);
  }
  return zones;
}

/** The weekday-in-month a date is: `2SU`, or `-1SU` in a month's last seven days. */
function byDayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const ordinal = d > daysInMonth(y, m) - 7 ? -1 : Math.ceil(d / 7);
  return `${ordinal}${WEEKDAY_CODES[weekdayOf(date)]}`;
}

/** The first date in `year`'s `month` that is the `byDay` weekday (`2SU`, `-1SU`). */
function dateForByDay(year: number, month: number, byDay: string): string {
  const m = /^(-?\d)(\w\w)$/.exec(byDay);
  const ordinal = Number(m?.[1] ?? 1);
  const wd = (WEEKDAY_CODES as readonly string[]).indexOf(m?.[2] ?? 'SU');
  if (ordinal > 0) {
    const first = plainDate(year, month, 1);
    return addDays(first, ((wd - weekdayOf(first) + 7) % 7) + (ordinal - 1) * 7);
  }
  const last = plainDate(year, month, daysInMonth(year, month));
  return addDays(last, -((weekdayOf(last) - wd + 7) % 7));
}

/**
 * A VTIMEZONE for an IANA zone, built from the offsets `Intl` reports in `year` (PRD §4.3). Each change of
 * offset becomes a yearly rule on its weekday in the month; a zone with no changes gets one STANDARD part.
 */
export function vtimezoneFor(id: string, year: number): ComponentNode {
  const zone: Zone = { kind: 'iana', id };
  const changes = transitionsIn(zone, year, id);
  const parts: CalendarNode[] = [propertyNode('TZID', id)];
  if (!changes.length) {
    const utc = toEpochDay(plainDate(year, 1, 1)) * SECONDS_PER_DAY;
    const offset = offsetAt(zone, utc, id);
    parts.push(
      componentNode('STANDARD', [
        propertyNode('DTSTART', '19700101T000000'),
        propertyNode('TZOFFSETFROM', formatOffset(offset)),
        propertyNode('TZOFFSETTO', formatOffset(offset)),
        propertyNode('TZNAME', zoneAbbreviation(id, utc)),
      ]),
    );
    return componentNode('VTIMEZONE', parts);
  }
  const largest = Math.max(...changes.map((c) => c.to));
  for (const change of changes) {
    const local = fromLocalSeconds(change.at + change.from);
    const date = local.slice(0, 10);
    const [, month] = date.split('-').map(Number) as [number, number];
    const byDay = byDayOf(date);
    const start1970 = `${dateForByDay(1970, month, byDay).replaceAll('-', '')}T${local.slice(11).replaceAll(':', '')}`;
    const kind = change.to === largest && changes.length > 1 ? 'DAYLIGHT' : 'STANDARD';
    parts.push(
      componentNode(kind, [
        propertyNode('DTSTART', start1970),
        propertyNode('TZOFFSETFROM', formatOffset(change.from)),
        propertyNode('TZOFFSETTO', formatOffset(change.to)),
        propertyNode(
          'RRULE',
          formatRule(
            rule('YEARLY', {
              byMonth: [month],
              byDay: [{ weekday: weekdayOfCode(byDay), ordinal: Number(byDay.slice(0, -2)) }],
            }),
          ),
        ),
        propertyNode('TZNAME', zoneAbbreviation(id, change.at + 1)),
      ]),
    );
  }
  return componentNode('VTIMEZONE', parts);
}

function weekdayOfCode(byDay: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return (WEEKDAY_CODES as readonly string[]).indexOf(byDay.slice(-2)) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * Adds a VTIMEZONE for each TZID in `tzids` that the file doesn't define and that is an IANA id (PRD §3.3),
 * after any VTIMEZONEs already there, else before the first event. Returns the same calendar when none was
 * missing.
 */
export function withVTimezones(
  calendar: ComponentNode,
  tzids: Iterable<string>,
  year: number,
): ComponentNode {
  const defined = new Set(components(calendar, 'VTIMEZONE').map((c) => property(c, 'TZID')?.value.trim()));
  const missing = [...new Set(tzids)].filter((id) => !defined.has(id));
  if (!missing.length) return calendar;
  const added = missing.map((id) => vtimezoneFor(id, year));
  const children = [...calendar.children];
  let at = children.findLastIndex((c) => c.kind === 'component' && c.name === 'VTIMEZONE') + 1;
  if (at === 0) {
    const firstComponent = children.findIndex((c) => c.kind === 'component');
    at = firstComponent < 0 ? children.length : firstComponent;
  }
  children.splice(at, 0, ...added);
  return withChildren(calendar, children);
}
