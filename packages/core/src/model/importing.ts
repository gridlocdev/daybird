/**
 * Import (PRD §11): another file's events added to a calendar. Events whose UID the calendar already has are
 * skipped; events with no UID get one. The zones they use come along as VTIMEZONEs the calendar lacks.
 */
import {
  components,
  property,
  propertyNode,
  withChildren,
  withProperty,
  type CalendarNode,
  type ComponentNode,
} from '../ical/document.ts';
import {
  findSeries,
  seriesEvents,
  seriesOf,
  withDocument,
  withSeriesEvents,
  type EventSeries,
} from './calendar.ts';
import { withCalendar, type EditContext, type Workspace } from './workspace.ts';

export interface ImportResult {
  readonly workspace: Workspace;
  /** Series added. */
  readonly added: number;
  /** Series skipped because the calendar has their UID. */
  readonly skipped: number;
}

/** The events a file would import: one per UID, and one for each event with no UID. */
export function importableSeries(source: ComponentNode): EventSeries[] {
  const out = seriesOf(source).filter((s) => s.uid);
  // Events with no UID can't be told apart: each is its own event.
  for (const e of components(source, 'VEVENT'))
    if (!property(e, 'UID')?.value.trim()) out.push({ uid: '', master: e, overrides: [] });
  return out;
}

const tzidOf = (c: ComponentNode) => property(c, 'TZID')?.value.trim() ?? '';

/** Adds `source`'s events to the calendar `calendarId`. A read-only or missing calendar takes nothing. */
export function importEvents(
  ws: Workspace,
  ctx: EditContext,
  calendarId: string,
  source: ComponentNode,
): ImportResult {
  const calendar = ws.calendars.find((c) => c.id === calendarId);
  if (!calendar || calendar.readOnly) return { workspace: ws, added: 0, skipped: 0 };
  let document = calendar.document;
  let added = 0;
  let skipped = 0;
  for (const s of importableSeries(source)) {
    if (s.uid && findSeries(document, s.uid)) {
      skipped++;
      continue;
    }
    let series = s;
    if (!s.uid) {
      const uid = ctx.makeUid();
      series = { uid, master: s.master && withProperty(s.master, propertyNode('UID', uid)), overrides: [] };
    }
    document = withSeriesEvents(document, series.uid, seriesEvents(series));
    added++;
  }
  if (!added) return { workspace: ws, added, skipped };
  document = withZonesFrom(document, source);
  return { workspace: withCalendar(ws, withDocument(calendar, document)), added, skipped };
}

/** `document` with every VTIMEZONE of `source` whose TZID it doesn't have, before its first VEVENT. */
function withZonesFrom(document: ComponentNode, source: ComponentNode): ComponentNode {
  const have = new Set(components(document, 'VTIMEZONE').map(tzidOf));
  const extra = components(source, 'VTIMEZONE').filter((z) => tzidOf(z) && !have.has(tzidOf(z)));
  if (!extra.length) return document;
  const children: readonly CalendarNode[] = document.children;
  const first = children.findIndex((c) => c.kind === 'component' && c.name === 'VEVENT');
  const at = first < 0 ? children.length : first;
  return withChildren(document, [...children.slice(0, at), ...extra, ...children.slice(at)]);
}
