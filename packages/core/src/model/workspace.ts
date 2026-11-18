/**
 * The open calendars and the trash, and every change to events (PRD §7, §8.2). Changes are pure: they return a new
 * workspace that shares whatever didn't change, so `undo.ts` can tell which files changed by reference. Each
 * changed VEVENT gets DTSTAMP, LAST-MODIFIED and SEQUENCE (§3.3), and each file gets a VTIMEZONE for every IANA
 * zone an edited event uses that it doesn't define.
 */
import {
  components,
  paramValue,
  property,
  propertyNode,
  withProperty,
  type ComponentNode,
} from '../ical/document.ts';
import type { TimeValue } from '../ical/values.ts';
import { withVTimezones } from '../ical/vtimezone.ts';
import { isIanaZone } from '../time/zones.ts';
import {
  calendarZones,
  findSeries,
  seriesEvents,
  seriesOf,
  withDocument,
  withSeriesEvents,
  type Calendar,
  type EventSeries,
} from './calendar.ts';
import { newEvent, readEvent, wallSeconds, withEditStamps, withTimeList, type EventPatch } from './event.ts';
import { eventForKey, isRepeating, keyIn, valueAtKey } from './occurrences.ts';
import {
  editAll,
  editFuture,
  editThis,
  isFirstKey,
  makeOverride,
  overrideAt,
  splitSeries,
  uidOf,
  type Scope,
  type SeriesContext,
} from './seriesEdits.ts';
import { withTrashEntry } from './trash.ts';

export interface Workspace {
  /** In sidebar order. */
  readonly calendars: readonly Calendar[];
  /** `.daybird/trash.ics` (§7.7). */
  readonly trash: ComponentNode;
}

export interface EditContext {
  /** UTC seconds. */
  readonly now: number;
  readonly makeUid: () => string;
  readonly displayZone: string;
}

/** An occurrence, or a whole event when `key` is null. */
export interface OccurrenceRef {
  readonly calendarId: string;
  readonly uid: string;
  readonly key: number | null;
}

export function calendarById(ws: Workspace, id: string): Calendar | null {
  return ws.calendars.find((c) => c.id === id) ?? null;
}

export function withCalendar(ws: Workspace, calendar: Calendar): Workspace {
  const at = ws.calendars.findIndex((c) => c.id === calendar.id);
  if (at < 0) return { ...ws, calendars: [...ws.calendars, calendar] };
  if (ws.calendars[at] === calendar) return ws;
  return { ...ws, calendars: ws.calendars.map((c, i) => (i === at ? calendar : c)) };
}

export function withoutCalendar(ws: Workspace, id: string): Workspace {
  const calendars = ws.calendars.filter((c) => c.id !== id);
  return calendars.length === ws.calendars.length ? ws : { ...ws, calendars };
}

function writable(ws: Workspace, id: string): Calendar {
  const c = calendarById(ws, id);
  if (!c) throw new Error(`No calendar ${id}.`);
  if (c.readOnly) throw new Error(`${c.name} can't be changed.`);
  return c;
}

function seriesCtx(calendar: Calendar, ctx: EditContext): SeriesContext {
  return { zones: calendarZones(calendar.document), displayZone: ctx.displayZone, makeUid: ctx.makeUid };
}

/** The TZIDs an event's times name. */
function tzidsOf(event: ComponentNode): string[] {
  const out: string[] = [];
  for (const name of ['DTSTART', 'DTEND', 'RECURRENCE-ID', 'RDATE', 'EXDATE']) {
    for (const c of event.children) {
      if (c.kind !== 'property' || c.name !== name) continue;
      const tzid = paramValue(c, 'TZID');
      if (tzid) out.push(tzid);
    }
  }
  return out;
}

function eventIdentity(e: ComponentNode): string {
  return `${uidOf(e)} ${property(e, 'RECURRENCE-ID')?.value ?? ''}`;
}

/**
 * Writes a series' new events into a calendar: stamps each VEVENT that changed against the one with the same UID
 * and RECURRENCE-ID before, and adds missing VTIMEZONEs.
 */
function putSeries(
  calendar: Calendar,
  uid: string,
  before: readonly ComponentNode[],
  after: readonly ComponentNode[],
  ctx: EditContext,
): Calendar {
  const old = new Map(before.map((e) => [eventIdentity(e), e]));
  const known = new Set(before);
  const stamped = after.map((e) =>
    known.has(e) ? e : withEditStamps(old.get(eventIdentity(e)) ?? null, e, ctx.now),
  );
  let document = withSeriesEvents(calendar.document, uid, stamped);
  if (document === calendar.document) return calendar;
  const tzids = stamped
    .filter((e) => !known.has(e))
    .flatMap(tzidsOf)
    .filter(isIanaZone);
  document = withVTimezones(document, tzids, new Date(ctx.now * 1000).getUTCFullYear());
  return withDocument(calendar, document);
}

function putNewSeries(calendar: Calendar, series: EventSeries, ctx: EditContext): Calendar {
  return putSeries(calendar, series.uid, [], seriesEvents(series), ctx);
}

/** A UID not used in the calendar: `uid` itself, else a new one, set on every event of the series. */
function freeUid(calendar: Calendar, series: EventSeries, ctx: EditContext): EventSeries {
  if (!findSeries(calendar.document, series.uid)) return series;
  const uid = ctx.makeUid();
  const set = (e: ComponentNode) => withProperty(e, propertyNode('UID', uid));
  return { uid, master: series.master ? set(series.master) : null, overrides: series.overrides.map(set) };
}

export interface NewEventFields extends EventPatch {
  readonly start: TimeValue;
  readonly end: TimeValue;
}

/** Creates an event (§7.1). Returns where it is. */
export function createEvent(
  ws: Workspace,
  ctx: EditContext,
  calendarId: string,
  fields: NewEventFields,
): { workspace: Workspace; ref: OccurrenceRef } {
  const calendar = writable(ws, calendarId);
  const uid = ctx.makeUid();
  const event = newEvent(uid, fields, ctx.now);
  const next = putSeries(calendar, uid, [], [event], ctx);
  return { workspace: withCalendar(ws, next), ref: { calendarId, uid, key: null } };
}

function getSeries(calendar: Calendar, uid: string): EventSeries {
  const s = findSeries(calendar.document, uid);
  if (!s) throw new Error(`No event ${uid} in ${calendar.name}.`);
  return s;
}

/** Whether the occurrence belongs to a repeating series, so a change asks This/Future/All (§8.2). */
export function needsScope(ws: Workspace, ref: OccurrenceRef): boolean {
  const calendar = calendarById(ws, ref.calendarId);
  const series = calendar ? findSeries(calendar.document, ref.uid) : null;
  if (!series || ref.key === null) return false;
  return series.master ? isRepeating(readEvent(series.master)) : false;
}

/**
 * Edits an occurrence (§7.2, §7.3, §8.2). `toCalendar` moves it: a whole series moves with All Events, the split
 * series with This and Future, and one occurrence of a repeating event leaves the series as a single event in
 * the other calendar. Returns where the edited occurrence is now.
 */
export function editOccurrence(
  ws: Workspace,
  ctx: EditContext,
  ref: OccurrenceRef,
  patch: EventPatch,
  scope: Scope,
  toCalendar: string = ref.calendarId,
): { workspace: Workspace; ref: OccurrenceRef } {
  const calendar = writable(ws, ref.calendarId);
  const target = toCalendar === ref.calendarId ? calendar : writable(ws, toCalendar);
  const sctx = seriesCtx(calendar, ctx);
  const series = getSeries(calendar, ref.uid);
  const repeating = needsScope(ws, ref);
  const key = ref.key;
  const before = seriesEvents(series);

  if (!repeating || key === null || scope === 'all' || (scope === 'future' && isFirstKey(series, key))) {
    const changed = editAll(series, key, patch, sctx);
    if (target === calendar) {
      const next = putSeries(calendar, series.uid, before, changed.events, ctx);
      return { workspace: withCalendar(ws, next), ref };
    }
    const moved = freeUid(
      target,
      { uid: series.uid, master: changed.events[0] ?? null, overrides: changed.events.slice(1) },
      ctx,
    );
    const stamped: EventSeries = {
      ...moved,
      master: moved.master ? withEditStamps(null, moved.master, ctx.now) : null,
    };
    let next = withCalendar(ws, withDocument(calendar, withSeriesEvents(calendar.document, series.uid, [])));
    next = withCalendar(next, putNewSeries(target, stamped, ctx));
    return { workspace: next, ref: { calendarId: target.id, uid: moved.uid, key } };
  }

  if (scope === 'this') {
    if (target === calendar) {
      const changed = editThis(series, key, patch, sctx);
      return {
        workspace: withCalendar(ws, putSeries(calendar, series.uid, before, changed.events, ctx)),
        ref,
      };
    }
    // One occurrence to another calendar: skipped here, a single event there.
    const source = eventForKey(series, key, sctx.zones, ctx.displayZone);
    if (!source || !series.master) throw new Error('No such occurrence.');
    const single = overrideAt(series, key, sctx) ?? makeOverride(series.master, key);
    const uid = ctx.makeUid();
    let event = withProperty(single, propertyNode('UID', uid));
    event = {
      ...event,
      children: event.children.filter((c) => !(c.kind === 'property' && c.name === 'RECURRENCE-ID')),
    };
    const skipped = skipOccurrence(series, key, sctx);
    let next = withCalendar(ws, putSeries(calendar, series.uid, before, skipped, ctx));
    const created = putSeries(
      target,
      uid,
      [],
      [
        withEditStamps(
          null,
          editAll({ uid, master: event, overrides: [] }, null, patch, sctx).events[0] ?? event,
          ctx.now,
        ),
      ],
      ctx,
    );
    next = withCalendar(next, created);
    return { workspace: next, ref: { calendarId: target.id, uid, key: null } };
  }

  const changed = editFuture(series, key, patch, sctx);
  let next = withCalendar(ws, putSeries(calendar, series.uid, before, changed.events, ctx));
  if (!changed.split) return { workspace: next, ref };
  const into = calendarById(next, target.id) ?? target;
  const split = target === calendar ? changed.split : freeUid(into, changed.split, ctx);
  next = withCalendar(next, putNewSeries(into, split, ctx));
  const newKey = split.master ? wallSeconds(readEvent(split.master).start) : key;
  return { workspace: next, ref: { calendarId: target.id, uid: split.uid, key: newKey } };
}

/** The series with occurrence `key` skipped: an EXDATE, and its override removed (§8.2). */
function skipOccurrence(series: EventSeries, key: number, ctx: SeriesContext): ComponentNode[] {
  if (!series.master) return [];
  const own = overrideAt(series, key, ctx);
  const info = readEvent(series.master);
  const exDate = valueAtKey(key, info.start);
  const already = info.exDates.some((v) => keyIn(v, info.start, ctx.zones, ctx.displayZone) === key);
  const master = already ? series.master : withTimeList(series.master, 'EXDATE', [...info.exDates, exDate]);
  return [master, ...series.overrides.filter((o) => o !== own)];
}

/**
 * Deletes an occurrence (§7.7, §8.2) into the trash. A single event or All Events moves the series; This Event
 * skips the occurrence with an EXDATE (even the first); This and Future ends the rule and trashes the rest.
 */
export function deleteOccurrence(
  ws: Workspace,
  ctx: EditContext,
  ref: OccurrenceRef,
  scope: Scope,
): Workspace {
  const calendar = writable(ws, ref.calendarId);
  const sctx = seriesCtx(calendar, ctx);
  const series = getSeries(calendar, ref.uid);
  const before = seriesEvents(series);
  const key = ref.key;
  const repeating = needsScope(ws, ref);

  if (!repeating || key === null || scope === 'all' || (scope === 'future' && isFirstKey(series, key))) {
    const next = withCalendar(
      ws,
      withDocument(calendar, withSeriesEvents(calendar.document, series.uid, [])),
    );
    return { ...next, trash: withTrashEntry(ws.trash, ctx, calendar.id, 'series', before) };
  }
  if (scope === 'this') {
    if (!series.master) throw new Error('No such occurrence.');
    const own = overrideAt(series, key, sctx);
    const removed = own ?? makeOverride(series.master, key);
    const next = withCalendar(
      ws,
      putSeries(calendar, series.uid, before, skipOccurrence(series, key, sctx), ctx),
    );
    return {
      ...next,
      trash: withTrashEntry(ws.trash, ctx, calendar.id, own ? 'override' : 'occurrence', [removed]),
    };
  }
  const { head, headOverrides, tail } = splitSeries(series, key, sctx);
  const next = withCalendar(ws, putSeries(calendar, series.uid, before, [head, ...headOverrides], ctx));
  return { ...next, trash: withTrashEntry(ws.trash, ctx, calendar.id, 'series', seriesEvents(tail)) };
}

/** Every UID in a calendar. */
export function uidsOf(calendar: Calendar): Set<string> {
  return new Set(seriesOf(calendar.document).map((s) => s.uid));
}

/** How many events (series) a calendar holds, for "Delete <name> and its N events?" (§7.7). */
export function eventCount(calendar: Calendar): number {
  return seriesOf(calendar.document).length;
}

/** Re-exported for the trash: a calendar's events of one UID. */
export function eventsOfUid(calendar: Calendar, uid: string): ComponentNode[] {
  return components(calendar.document, 'VEVENT').filter((e) => uidOf(e) === uid);
}
