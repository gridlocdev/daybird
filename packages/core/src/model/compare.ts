/**
 * How many events differ between two versions of a calendar file: for "Updated <calendar> with N changes made
 * elsewhere." and the conflict dialog (PRD §3.5). An event is its UID plus RECURRENCE-ID; one that was added,
 * removed or written differently counts once.
 */
import { property, writeCalendar, type ComponentNode } from '../ical/document.ts';

function eventsByIdentity(calendar: ComponentNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of calendar.children) {
    if (c.kind !== 'component' || c.name !== 'VEVENT') continue;
    const id = `${property(c, 'UID')?.value.trim() ?? ''}|${property(c, 'RECURRENCE-ID')?.value.trim() ?? ''}`;
    out.set(id, (out.get(id) ?? '') + writeCalendar(c));
  }
  return out;
}

export function countEventChanges(before: ComponentNode, after: ComponentNode): number {
  if (before === after) return 0;
  const a = eventsByIdentity(before);
  const b = eventsByIdentity(after);
  let n = 0;
  for (const [id, text] of a) if (b.get(id) !== text) n++;
  for (const id of b.keys()) if (!a.has(id)) n++;
  return n;
}
