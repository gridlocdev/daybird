/**
 * Undo (PRD §7.6). A step records each calendar file and the trash as they were before and after a change, so
 * undo puts back exactly those files, whatever else changed since. A change that changed nothing records no step
 * (§4.2).
 */
import type { ComponentNode } from '../ical/document.ts';
import type { Calendar } from './calendar.ts';
import type { Workspace } from './workspace.ts';

export const UNDO_LIMIT = 200;

export interface UndoStep {
  /** "Moved Lunch to Thursday". */
  readonly label: string;
  /** By calendar id; null for a calendar that didn't exist on that side. */
  readonly before: ReadonlyMap<string, Calendar | null>;
  readonly after: ReadonlyMap<string, Calendar | null>;
  readonly trashBefore: ComponentNode | null;
  readonly trashAfter: ComponentNode | null;
}

export interface UndoStack {
  readonly done: readonly UndoStep[];
  readonly undone: readonly UndoStep[];
}

export const EMPTY_UNDO: UndoStack = { done: [], undone: [] };

/** The step from `before` to `after`, or null when nothing changed. */
export function diffStep(label: string, before: Workspace, after: Workspace): UndoStep | null {
  const b = new Map<string, Calendar | null>();
  const a = new Map<string, Calendar | null>();
  const ids = new Set([...before.calendars.map((c) => c.id), ...after.calendars.map((c) => c.id)]);
  for (const id of ids) {
    const x = before.calendars.find((c) => c.id === id) ?? null;
    const y = after.calendars.find((c) => c.id === id) ?? null;
    if (x === y || (x && y && x.document === y.document && x.name === y.name && x.color === y.color))
      continue;
    b.set(id, x);
    a.set(id, y);
  }
  const trashChanged = before.trash !== after.trash;
  if (!b.size && !trashChanged) return null;
  return {
    label,
    before: b,
    after: a,
    trashBefore: trashChanged ? before.trash : null,
    trashAfter: trashChanged ? after.trash : null,
  };
}

/** Adds a step; the redo list clears and the oldest step drops past 200. */
export function pushStep(stack: UndoStack, step: UndoStep | null): UndoStack {
  if (!step) return stack;
  return { done: [...stack.done, step].slice(-UNDO_LIMIT), undone: [] };
}

function apply(
  ws: Workspace,
  calendars: ReadonlyMap<string, Calendar | null>,
  trash: ComponentNode | null,
): Workspace {
  let list = [...ws.calendars];
  for (const [id, calendar] of calendars) {
    const at = list.findIndex((c) => c.id === id);
    if (!calendar) list = list.filter((c) => c.id !== id);
    else if (at >= 0) list[at] = calendar;
    else list.push(calendar);
  }
  return { calendars: list, trash: trash ?? ws.trash };
}

export interface UndoResult {
  readonly workspace: Workspace;
  readonly stack: UndoStack;
  readonly step: UndoStep;
  /** The calendars to save. */
  readonly changed: readonly string[];
}

export function undo(ws: Workspace, stack: UndoStack): UndoResult | null {
  const step = stack.done.at(-1);
  if (!step) return null;
  return {
    workspace: apply(ws, step.before, step.trashBefore),
    stack: { done: stack.done.slice(0, -1), undone: [...stack.undone, step] },
    step,
    changed: [...step.before.keys()],
  };
}

export function redo(ws: Workspace, stack: UndoStack): UndoResult | null {
  const step = stack.undone.at(-1);
  if (!step) return null;
  return {
    workspace: apply(ws, step.after, step.trashAfter),
    stack: { done: [...stack.done, step], undone: stack.undone.slice(0, -1) },
    step,
    changed: [...step.after.keys()],
  };
}

/** Joins steps into one (the popover's open-to-close, §7.2). The label is the last one's. */
export function mergeSteps(first: UndoStep, second: UndoStep): UndoStep {
  const before = new Map(first.before);
  const after = new Map(first.after);
  for (const [id, c] of second.before) if (!before.has(id)) before.set(id, c);
  for (const [id, c] of second.after) after.set(id, c);
  return {
    label: second.label,
    before,
    after,
    trashBefore: first.trashBefore ?? second.trashBefore,
    trashAfter: second.trashAfter ?? first.trashAfter,
  };
}

/** Drops every step: a conflict took the file on disk (§7.6). */
export function clearUndo(): UndoStack {
  return EMPTY_UNDO;
}

/**
 * Forgets a calendar whose file went from the folder or was taken over its changes (§3.5): every step that changed
 * it goes, so undo can never bring back a calendar whose file is gone, or write an old version over the disk's.
 */
export function withoutCalendarSteps(stack: UndoStack, calendarId: string): UndoStack {
  const keep = (s: UndoStep) => !s.before.has(calendarId) && !s.after.has(calendarId);
  return { done: stack.done.filter(keep), undone: stack.undone.filter(keep) };
}
