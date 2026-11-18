/**
 * An event's times in other frames (PRD §4.3): in the display zone for the views and the popover without time zone
 * support, back on the event's own clock for writing, and the same clock time in another zone for the zone field.
 */
import type { TimeValue } from '../ical/values.ts';
import { fromLocalSeconds } from '../time/dateTime.ts';
import { FLOATING, isIanaZone, toLocal, type Zone } from '../time/zones.ts';
import { zoneDateTime } from './eventTimes.ts';
import { instantOf, zoneOf } from './occurrences.ts';

type Times = { readonly start: TimeValue; readonly end: TimeValue };
type Zones = ReadonlyMap<string, Zone>;

/** The same instants as wall-clock times in the display zone. All-day events stay as they are. */
export function inDisplayZone(t: Times, zones: Zones, displayZone: string): Times {
  if (t.start.kind === 'date' || t.end.kind === 'date') return t;
  const shown = (v: TimeValue): TimeValue =>
    zoneDateTime(
      fromLocalSeconds(toLocal(instantOf(v, zones, displayZone), FLOATING, displayZone)),
      displayZone,
    );
  return { start: shown(t.start), end: shown(t.end) };
}

/** The same instants on `like`'s clock: its zone, UTC or floating. All-day times stay as they are. */
export function inFrameOf(t: Times, like: TimeValue, zones: Zones, displayZone: string): Times {
  if (t.start.kind === 'date' || t.end.kind === 'date' || like.kind === 'date') return t;
  const zone = zoneOf(like, zones).zone;
  const own = (v: TimeValue): TimeValue => ({
    ...like,
    dateTime: fromLocalSeconds(toLocal(instantOf(v, zones, displayZone), zone, displayZone)),
  });
  return { start: own(t.start), end: own(t.end) };
}

/** The same clock times in another zone, or floating for null: what changing the zone field does. */
export function withZone(t: Times, zone: string | null): Times {
  const moved = (v: TimeValue): TimeValue =>
    v.kind === 'date'
      ? v
      : zone === null
        ? { kind: 'date-time', dateTime: v.dateTime, utc: false, tzid: null }
        : zoneDateTime(v.dateTime, zone);
  return { start: moved(t.start), end: moved(t.end) };
}

/** The zone a time is on: 'UTC', its TZID, or null when it floats (or is a date). */
export function zoneIdOf(v: TimeValue): string | null {
  if (v.kind === 'date') return null;
  return v.utc ? 'UTC' : v.tzid;
}

/** A zone's short name: "New York" for America/New_York, "Indiana/Knox" keeps its region. */
export function zoneName(id: string): string {
  const parts = id.split('/');
  return (parts.length > 2 ? parts.slice(1) : parts.slice(-1)).join('/').replaceAll('_', ' ');
}

let ids: readonly string[] | null = null;

/** Every IANA zone the runtime knows, and UTC, in order. */
export function timeZoneIds(): readonly string[] {
  ids ??= [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC'])].filter(isIanaZone).sort();
  return ids;
}
