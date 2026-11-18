/**
 * What a calendar file says about itself (PRD §3.1) and the house stamps Daybird puts on files it
 * changes (PRD §3.2, §3.3).
 */
import { escapeText, unescapeText } from './contentLine.ts';
import {
  components,
  property,
  propertyNode,
  withChildren,
  withProperty,
  type ComponentNode,
} from './document.ts';

/** The PRODID Daybird writes into a file it changes. */
export function daybirdProductId(version: string): string {
  return `-//Daybird//Daybird ${version}//EN`;
}

/** The calendar's name: X-WR-CALNAME, else the file name without `.ics`. */
export function calendarName(calendar: ComponentNode, fileName: string): string {
  const name = property(calendar, 'X-WR-CALNAME');
  const text = name ? unescapeText(name.value).trim() : '';
  return text !== '' ? text : fileName.replace(/\.ics$/i, '');
}

/** The calendar's colour as `#rrggbb` from X-APPLE-CALENDAR-COLOR (`#RRGGBB` or `#RRGGBBAA`), else null. */
export function calendarColour(calendar: ComponentNode): string | null {
  const value = property(calendar, 'X-APPLE-CALENDAR-COLOR')?.value.trim() ?? '';
  const m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value);
  return m?.[1] ? `#${m[1].toLowerCase()}` : null;
}

export function withCalendarName(calendar: ComponentNode, name: string): ComponentNode {
  return withProperty(calendar, propertyNode('X-WR-CALNAME', escapeText(name)));
}

export function withCalendarColour(calendar: ComponentNode, colour: string): ComponentNode {
  return withProperty(calendar, propertyNode('X-APPLE-CALENDAR-COLOR', colour.toUpperCase()));
}

/**
 * Gives every event without a UID a new one from `makeUid` (PRD §3.2). Returns the same calendar when
 * nothing was missing, so the caller can tell whether the file changed.
 */
export function withEventUids(calendar: ComponentNode, makeUid: () => string): ComponentNode {
  if (components(calendar, 'VEVENT').every((e) => property(e, 'UID'))) return calendar;
  return withChildren(
    calendar,
    calendar.children.map((c) =>
      c.kind === 'component' && c.name === 'VEVENT' && !property(c, 'UID')
        ? withProperty(c, propertyNode('UID', makeUid()))
        : c,
    ),
  );
}

/** Marks a changed file as written by Daybird: PRODID and VERSION:2.0 (PRD §3.3). */
export function withDaybirdStamp(calendar: ComponentNode, version: string): ComponentNode {
  return withProperty(
    withProperty(calendar, propertyNode('PRODID', daybirdProductId(version))),
    propertyNode('VERSION', '2.0'),
  );
}
