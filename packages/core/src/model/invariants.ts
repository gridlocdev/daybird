/**
 * The engine's rules (PRD §4.2), checked after every operation in tests. Returns what's broken, in words; an
 * empty list means the workspace is sound.
 */
import { property } from '../ical/document.ts';
import { isInSet } from '../time/recurrenceSet.ts';
import { calendarZones, seriesOf } from './calendar.ts';
import { readEvent, wallSeconds } from './event.ts';
import { keyIn, recurrenceSetOf } from './occurrences.ts';
import { trashEntries } from './trash.ts';
import type { Workspace } from './workspace.ts';

export function checkInvariants(ws: Workspace, displayZone: string): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const calendar of ws.calendars) {
    if (ids.has(calendar.id)) problems.push(`Two calendars are called ${calendar.id}.`);
    ids.add(calendar.id);
    if (calendar.readOnly) continue;
    const zones = calendarZones(calendar.document);
    const masters = new Map<string, number>();
    for (const c of calendar.document.children) {
      if (c.kind !== 'component' || c.name !== 'VEVENT') continue;
      const uid = property(c, 'UID')?.value.trim() ?? '';
      if (!uid) problems.push(`${calendar.id}: an event has no UID.`);
      if (!property(c, 'RECURRENCE-ID')) masters.set(uid, (masters.get(uid) ?? 0) + 1);
      const info = readEvent(c);
      if (info.start.kind !== info.end.kind)
        problems.push(`${calendar.id} ${uid}: start and end are of different kinds.`);
      if (
        info.start.kind === info.end.kind &&
        info.start.kind === 'date' &&
        wallSeconds(info.end) <= wallSeconds(info.start)
      ) {
        problems.push(`${calendar.id} ${uid}: an all-day event ends before its start.`);
      }
    }
    for (const [uid, n] of masters)
      if (n > 1) problems.push(`${calendar.id}: ${n} events share the UID ${uid}.`);

    for (const series of seriesOf(calendar.document)) {
      if (!series.master) continue;
      const master = readEvent(series.master);
      const set = recurrenceSetOf(master, zones, displayZone);
      const exDates = new Set(set.exDates);
      const seen = new Set<number>();
      for (const o of series.overrides) {
        const rid = readEvent(o).recurrenceId;
        if (!rid) continue;
        if (rid.kind !== master.start.kind)
          problems.push(
            `${calendar.id} ${series.uid}: an override's RECURRENCE-ID is of a different kind from DTSTART.`,
          );
        const key = keyIn(rid, master.start, zones, displayZone);
        if (seen.has(key)) problems.push(`${calendar.id} ${series.uid}: two overrides for one occurrence.`);
        seen.add(key);
        if (exDates.has(key))
          problems.push(`${calendar.id} ${series.uid}: an occurrence is both skipped and changed.`);
        const inSet =
          master.rules.length || master.rDates.length
            ? isInSet({ ...set, exDates: [] }, key)
            : key === set.start;
        if (!inSet)
          problems.push(
            `${calendar.id} ${series.uid}: an override names an occurrence the rule doesn't make.`,
          );
      }
    }
  }
  for (const entry of trashEntries(ws.trash)) {
    if (!entry.calendarId) problems.push(`Trash entry ${entry.id} doesn't name its calendar.`);
  }
  return problems;
}
