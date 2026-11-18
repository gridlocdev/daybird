/**
 * The trash (PRD §7.7): `.daybird/trash.ics`, a calendar file of deleted events. Each deletion is one entry: the
 * VEVENTs it removed, each marked with X-DAYBIRD-ENTRY, X-DAYBIRD-KIND, X-DAYBIRD-CALENDAR (the file it came
 * from) and X-DAYBIRD-DELETED (UTC).
 */
import {
  componentNode,
  property,
  propertyNode,
  withChildren,
  withProperty,
  withoutProperty,
  type ComponentNode,
} from '../ical/document.ts';
import { parseTimeText, type TimeValue } from '../ical/values.ts';
import {
  calendarZones,
  findSeries,
  seriesEvents,
  withDocument,
  withSeriesEvents,
  type EventSeries,
} from './calendar.ts';
import { readEvent, utcStamp, wallSeconds, withEditStamps, withTimeList } from './event.ts';
import { keyIn } from './occurrences.ts';
import type { EditContext, Workspace } from './workspace.ts';

/** What a trash entry holds: a whole series, one occurrence that was skipped, or a changed occurrence. */
export type TrashKind = 'series' | 'occurrence' | 'override';

export interface TrashEntry {
  readonly id: string;
  readonly kind: TrashKind;
  readonly calendarId: string;
  /** UTC seconds. */
  readonly deleted: number;
  readonly title: string;
  readonly start: TimeValue;
  readonly events: readonly ComponentNode[];
}

/** Days a trashed item is kept (§7.7). */
export const TRASH_DAYS = 30;

const MARKS = ['X-DAYBIRD-ENTRY', 'X-DAYBIRD-KIND', 'X-DAYBIRD-CALENDAR', 'X-DAYBIRD-DELETED'];

export function emptyTrashDocument(): ComponentNode {
  return componentNode('VCALENDAR', [
    propertyNode('VERSION', '2.0'),
    propertyNode('PRODID', '-//Daybird//Daybird//EN'),
    propertyNode('X-WR-CALNAME', 'Trash'),
  ]);
}

/** The trash with a new entry for `events`, deleted from `calendarId` now. */
export function withTrashEntry(
  trash: ComponentNode,
  ctx: EditContext,
  calendarId: string,
  kind: TrashKind,
  events: readonly ComponentNode[],
): ComponentNode {
  if (!events.length) return trash;
  const id = ctx.makeUid();
  const marked = events.map((e) =>
    [
      propertyNode('X-DAYBIRD-ENTRY', id),
      propertyNode('X-DAYBIRD-KIND', kind.toUpperCase()),
      propertyNode('X-DAYBIRD-CALENDAR', calendarId),
      propertyNode('X-DAYBIRD-DELETED', utcStamp(ctx.now)),
    ].reduce((out, p) => withProperty(out, p), e),
  );
  return withChildren(trash, [...trash.children, ...marked]);
}

function unmark(event: ComponentNode): ComponentNode {
  return MARKS.reduce((e, name) => withoutProperty(e, name), event);
}

function deletedAt(event: ComponentNode): number {
  const v = parseTimeText(property(event, 'X-DAYBIRD-DELETED')?.value ?? '', null);
  return v?.kind === 'date-time' ? wallSeconds(v) : 0;
}

/** The entries, newest first. Events without an entry mark each form their own. */
export function trashEntries(trash: ComponentNode): TrashEntry[] {
  const byId = new Map<string, ComponentNode[]>();
  trash.children.forEach((c, i) => {
    if (c.kind !== 'component' || c.name !== 'VEVENT') return;
    const id = property(c, 'X-DAYBIRD-ENTRY')?.value.trim() || `line-${c.line || i}`;
    byId.set(id, [...(byId.get(id) ?? []), c]);
  });
  const out: TrashEntry[] = [];
  for (const [id, events] of byId) {
    const first = events.find((e) => !property(e, 'RECURRENCE-ID')) ?? events[0];
    if (!first) continue;
    const kind = (property(first, 'X-DAYBIRD-KIND')?.value.trim().toLowerCase() ?? 'series') as TrashKind;
    const info = readEvent(first);
    out.push({
      id,
      kind: kind === 'occurrence' || kind === 'override' ? kind : 'series',
      calendarId: property(first, 'X-DAYBIRD-CALENDAR')?.value.trim() ?? '',
      deleted: deletedAt(first),
      title: info.title,
      start: info.start,
      events,
    });
  }
  return out.sort((a, b) => b.deleted - a.deleted);
}

function withoutEntry(trash: ComponentNode, entry: TrashEntry): ComponentNode {
  const gone = new Set(entry.events);
  return withChildren(
    trash,
    trash.children.filter((c) => !(c.kind === 'component' && gone.has(c))),
  );
}

/**
 * Puts an entry back (§7.7) into the calendar it came from, or `fallbackCalendarId` when that one is gone or
 * can't be written. A skipped occurrence comes back by removing its EXDATE (and its override, when it had one);
 * when its series is gone it comes back as a single event. A series whose UID is taken gets a new one.
 */
export function restoreTrashEntry(
  ws: Workspace,
  ctx: EditContext,
  entryId: string,
  fallbackCalendarId: string,
): Workspace {
  const entry = trashEntries(ws.trash).find((e) => e.id === entryId);
  if (!entry) return ws;
  const pick = (id: string) => ws.calendars.find((c) => c.id === id && !c.readOnly);
  const calendar =
    pick(entry.calendarId) ?? pick(fallbackCalendarId) ?? ws.calendars.find((c) => !c.readOnly);
  if (!calendar) return ws;
  const events = entry.events.map(unmark);
  const trash = withoutEntry(ws.trash, entry);
  const first = events[0];
  if (!first) return { ...ws, trash };

  if (entry.kind !== 'series') {
    const uid = property(first, 'UID')?.value.trim() ?? '';
    const series = findSeries(calendar.document, uid);
    const rid = readEvent(first).recurrenceId;
    if (series?.master && rid) {
      const master = readEvent(series.master);
      const zones = calendarZones(calendar.document);
      const key = keyIn(rid, master.start, zones, ctx.displayZone);
      const exDates = master.exDates.filter((v) => keyIn(v, master.start, zones, ctx.displayZone) !== key);
      const nextMaster = withEditStamps(
        series.master,
        withTimeList(series.master, 'EXDATE', exDates),
        ctx.now,
      );
      const overrides = entry.kind === 'override' ? [...series.overrides, first] : series.overrides;
      const document = withSeriesEvents(calendar.document, uid, [nextMaster, ...overrides]);
      return { ...withCalendarIn(ws, withDocument(calendar, document)), trash };
    }
    // The series is gone: the occurrence comes back on its own.
    const single = withoutProperty(first, 'RECURRENCE-ID');
    return restoreSeries(ws, ctx, calendar.id, { uid, master: single, overrides: [] }, trash);
  }
  const master = events.find((e) => !property(e, 'RECURRENCE-ID')) ?? null;
  const series: EventSeries = {
    uid: property(first, 'UID')?.value.trim() ?? '',
    master,
    overrides: events.filter((e) => e !== master),
  };
  return restoreSeries(ws, ctx, calendar.id, series, trash);
}

function withCalendarIn(ws: Workspace, calendar: Workspace['calendars'][number]): Workspace {
  return { ...ws, calendars: ws.calendars.map((c) => (c.id === calendar.id ? calendar : c)) };
}

function restoreSeries(
  ws: Workspace,
  ctx: EditContext,
  calendarId: string,
  series: EventSeries,
  trash: ComponentNode,
): Workspace {
  const calendar = ws.calendars.find((c) => c.id === calendarId);
  if (!calendar) return ws;
  let s = series;
  if (findSeries(calendar.document, s.uid)) {
    const uid = ctx.makeUid();
    const set = (e: ComponentNode) => withProperty(e, propertyNode('UID', uid));
    s = { uid, master: s.master ? set(s.master) : null, overrides: s.overrides.map(set) };
  }
  const document = withSeriesEvents(calendar.document, s.uid, seriesEvents(s));
  return { ...withCalendarIn(ws, withDocument(calendar, document)), trash };
}

/** Removes an entry for good (§7.7: asks first, in the UI). */
export function deleteTrashEntry(ws: Workspace, entryId: string): Workspace {
  const entry = trashEntries(ws.trash).find((e) => e.id === entryId);
  return entry ? { ...ws, trash: withoutEntry(ws.trash, entry) } : ws;
}

export function emptyTrash(ws: Workspace): Workspace {
  const kept = ws.trash.children.filter((c) => !(c.kind === 'component' && c.name === 'VEVENT'));
  return kept.length === ws.trash.children.length ? ws : { ...ws, trash: withChildren(ws.trash, kept) };
}

/** Removes entries deleted more than 30 days before `now` (§7.7, when the folder loads). */
export function purgeTrash(ws: Workspace, now: number): Workspace {
  const old = trashEntries(ws.trash).filter((e) => e.deleted < now - TRASH_DAYS * 86_400);
  return old.reduce((w, e) => ({ ...w, trash: withoutEntry(w.trash, e) }), ws);
}
