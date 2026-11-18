/**
 * Calendars and event series (PRD §3.1, §4.1). A calendar keeps its whole parsed file, so whatever Daybird
 * doesn't use is written back unchanged; series are read from it on demand.
 */
import { nextCalendarColour } from '../colours.ts';
import { calendarColour, calendarName, withEventUids } from '../ical/calendarFile.ts';
import {
  componentNode,
  property,
  propertyNode,
  readCalendar,
  withChildren,
  type ComponentNode,
  type ReadProblem,
} from '../ical/document.ts';
import { fileZones } from '../ical/vtimezone.ts';
import type { Zone } from '../time/zones.ts';
import { readEvent, type EventInfo } from './event.ts';

export interface Calendar {
  /** The file name, `Work.ics`. */
  readonly id: string;
  readonly name: string;
  /** `#rrggbb`. */
  readonly color: string;
  /** The file couldn't be read and is never written (§3.2). */
  readonly readOnly: boolean;
  /** Why, when `readOnly`. */
  readonly error: ReadProblem | null;
  /** The VCALENDAR; an empty one for an unreadable file. */
  readonly document: ComponentNode;
  /** Lines that were skipped on reading. */
  readonly problems: readonly ReadProblem[];
}

export interface LoadedCalendar {
  readonly calendar: Calendar;
  /** The file needs saving: UIDs were added (§3.2). */
  readonly changed: boolean;
}

/** An empty VCALENDAR with a name and colour, as a new calendar file. */
export function emptyCalendarDocument(name: string, color: string): ComponentNode {
  return componentNode('VCALENDAR', [
    propertyNode('VERSION', '2.0'),
    propertyNode('PRODID', '-//Daybird//Daybird//EN'),
    propertyNode('CALSCALE', 'GREGORIAN'),
    propertyNode('X-WR-CALNAME', name),
    propertyNode('X-APPLE-CALENDAR-COLOR', color.toUpperCase()),
  ]);
}

/** Reads a calendar file. `usedColours` picks the colour of a calendar that has none (§3.1, §5.6). */
export function loadCalendar(
  id: string,
  text: string,
  makeUid: () => string,
  usedColours: readonly string[],
): LoadedCalendar {
  const read = readCalendar(text);
  if (!read.ok) {
    return {
      calendar: {
        id,
        name: id.replace(/\.ics$/i, ''),
        color: nextCalendarColour(usedColours),
        readOnly: true,
        error: read.error,
        document: componentNode('VCALENDAR'),
        problems: [],
      },
      changed: false,
    };
  }
  const document = withEventUids(read.calendar, makeUid);
  return {
    calendar: {
      id,
      name: calendarName(document, id),
      color: calendarColour(document) ?? nextCalendarColour(usedColours),
      readOnly: false,
      error: null,
      document,
      problems: read.problems,
    },
    changed: document !== read.calendar,
  };
}

/** The calendar with a new document; its name and colour are read again from it. */
export function withDocument(calendar: Calendar, document: ComponentNode): Calendar {
  if (document === calendar.document) return calendar;
  return {
    ...calendar,
    document,
    name: calendarName(document, calendar.id),
    color: calendarColour(document) ?? calendar.color,
  };
}

/** One UID: the master VEVENT (none when a file has only overrides) and its overrides (§4.1). */
export interface EventSeries {
  readonly uid: string;
  readonly master: ComponentNode | null;
  readonly overrides: readonly ComponentNode[];
}

/** The calendar's series, in file order of their first VEVENT. */
export function seriesOf(document: ComponentNode): EventSeries[] {
  const byUid = new Map<string, { uid: string; master: ComponentNode | null; overrides: ComponentNode[] }>();
  for (const child of document.children) {
    if (child.kind !== 'component' || child.name !== 'VEVENT') continue;
    const uid = property(child, 'UID')?.value.trim() ?? '';
    let s = byUid.get(uid);
    if (!s) {
      s = { uid, master: null, overrides: [] };
      byUid.set(uid, s);
    }
    if (property(child, 'RECURRENCE-ID')) s.overrides.push(child);
    else s.master ??= child;
  }
  return [...byUid.values()];
}

/** The series with this UID, or null. */
export function findSeries(document: ComponentNode, uid: string): EventSeries | null {
  return seriesOf(document).find((s) => s.uid === uid) ?? null;
}

/** The zones a calendar's events can use: its own VTIMEZONEs by TZID. */
export function calendarZones(document: ComponentNode): ReadonlyMap<string, Zone> {
  return fileZones(document);
}

/** Every VEVENT of `uid` replaced by `events` (a master first, then overrides), where the first one stood. */
export function withSeriesEvents(
  document: ComponentNode,
  uid: string,
  events: readonly ComponentNode[],
): ComponentNode {
  const isOfUid = (c: (typeof document.children)[number]) =>
    c.kind === 'component' && c.name === 'VEVENT' && (property(c, 'UID')?.value.trim() ?? '') === uid;
  const first = document.children.findIndex(isOfUid);
  const old = document.children.filter(isOfUid);
  if (old.length === events.length && old.every((c, i) => c === events[i])) return document;
  const rest = document.children.filter((c) => !isOfUid(c));
  const at = first < 0 ? rest.length : document.children.slice(0, first).filter((c) => !isOfUid(c)).length;
  return withChildren(document, [...rest.slice(0, at), ...events, ...rest.slice(at)]);
}

/** The series' events, master first, in the order `withSeriesEvents` takes. */
export function seriesEvents(series: EventSeries): ComponentNode[] {
  return series.master ? [series.master, ...series.overrides] : [...series.overrides];
}

/** Reads every event of a series. */
export function readSeries(series: EventSeries): { master: EventInfo | null; overrides: EventInfo[] } {
  return {
    master: series.master ? readEvent(series.master) : null,
    overrides: series.overrides.map(readEvent),
  };
}

/** Characters a file name can't have on some disk. Control characters become `-` too (`safeName`). */
const UNSAFE = /[\\/:*?"<>|]/g;

const safeName = (name: string) =>
  [...name.replace(UNSAFE, '-')].map((ch) => (ch.charCodeAt(0) < 32 ? '-' : ch)).join('');

/**
 * The file name for a new calendar (§3.1): its name with unsafe characters as `-`, and ` 2`, ` 3`… when the name
 * is taken. `taken` compares without case, as macOS and Windows disks do.
 */
export function calendarFileName(name: string, taken: readonly string[]): string {
  const base = safeName(name).replace(/^\.+/, '-').trim() || 'Calendar';
  const used = new Set(taken.map((t) => t.toLowerCase()));
  for (let i = 1; ; i++) {
    const file = `${base}${i === 1 ? '' : ` ${i}`}.ics`;
    if (!used.has(file.toLowerCase())) return file;
  }
}
