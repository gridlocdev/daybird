/**
 * Moving, copying and pasting events (PRD §7.3, §7.5): drags, arrow keys, ⌘C ⌘X ⌘V ⌘D and the right-click menus
 * all come here. Each change is one undo step; a move of a repeating occurrence asks which ones (§8.2).
 */
import {
  calendarById,
  copyFields,
  createEvent,
  editOccurrence,
  eventAsText,
  inDisplayZone,
  inFrameOf,
  movedTimes,
  needsScope,
  occurrenceDetails,
  onDate,
  sameTimes,
  shiftedTimes,
  timedTimes,
  allDayTimes,
  type MoveTarget,
  type NewEventFields,
  type OccurrenceDetails,
  type TimeValue,
} from '@daybird/core';
import type { AppController, OccurrenceRef } from './controller.ts';
import { deleteEvent, newEventAt } from './eventActions.ts';

type Times = { start: TimeValue; end: TimeValue };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** An occurrence's details in its own frame, or null when it has gone. */
export function detailsOf(app: AppController, ref: OccurrenceRef): OccurrenceDetails | null {
  const ws = app.session.peek()?.workspace.peek();
  const calendar = ws && calendarById(ws, ref.calendarId);
  return calendar ? occurrenceDetails(calendar, ref.uid, ref.key, app.displayZone) : null;
}

/** Whether the event's calendar can be changed. */
export function canChange(app: AppController, ref: OccurrenceRef): boolean {
  const ws = app.session.peek()?.workspace.peek();
  const calendar = ws && calendarById(ws, ref.calendarId);
  return !!calendar && !calendar.readOnly;
}

/** Gives an occurrence new times: a drag, a resize or an arrow key. */
export function changeTimes(app: AppController, ref: OccurrenceRef, times: Times, verb = 'Move'): void {
  const session = app.session.peek();
  const d = detailsOf(app, ref);
  if (!session || !d || sameTimes(times, { start: d.start, end: d.end })) return;
  const ws = session.workspace.peek();
  if (needsScope(ws, ref)) {
    app.scopeQuestion.value = { action: 'edit', ref, patch: times, toCalendar: null };
    return;
  }
  try {
    const r = editOccurrence(ws, session.editContext(), ref, times, 'all');
    session.commit(`${verb} ${d.occurrence.title || 'New Event'}`, r.workspace);
    app.select(r.ref);
    showDate(app, times.start);
  } catch (e) {
    app.say(`Couldn’t move the event: ${message(e)}`, { tone: 'error' });
  }
}

/** Keeps a moved event in view: the anchor follows it out of the range. */
function showDate(app: AppController, start: TimeValue): void {
  const date = start.kind === 'date' ? start.date : (start.dateTime.slice(0, 10) as typeof app.anchor.value);
  const { start: from, end } = app.range.peek();
  if (date < from || date >= end) app.goTo(date);
}

/** Drops an event on `target`; with `copy` (Option-drag) a copy goes there instead (§7.3). */
export function dropEvent(app: AppController, ref: OccurrenceRef, target: Times, copy: boolean): void {
  const d = detailsOf(app, ref);
  if (!d) return;
  // The drag ran in the display zone; the event keeps its own.
  const own = inFrameOf(target, d.start, d.zones, app.displayZone);
  if (copy) addCopy(app, { ...copyFields(d), ...own }, ref.calendarId, 'Copy');
  else changeTimes(app, ref, own);
}

/** The arrow keys on a selected event: minutes in Day and Week, days, or a week in Month (§7.3). */
export function nudge(app: AppController, by: { readonly days?: number; readonly minutes?: number }): void {
  const ref = app.selected.peek();
  const d = ref && detailsOf(app, ref);
  if (!ref || !d || !canChange(app, ref)) return;
  const t = { start: d.start, end: d.end };
  if (by.minutes && t.start.kind === 'date') return;
  changeTimes(app, ref, shiftedTimes(t, by));
}

/** A new single event from copied fields, selected, in `calendarId` when it can take it, else the default. */
function addCopy(app: AppController, fields: NewEventFields, calendarId: string, verb: string): void {
  const session = app.session.peek();
  if (!session) return;
  const ws = session.workspace.peek();
  const own = calendarById(ws, calendarId);
  const calendar = own && !own.readOnly ? own : app.defaultCalendar.peek();
  if (!calendar) return;
  try {
    const made = createEvent(ws, session.editContext(), calendar.id, fields);
    session.commit(`${verb} ${fields.title || 'New Event'}`, made.workspace);
    app.select(made.ref);
    showDate(app, fields.start);
  } catch (e) {
    app.say(`Couldn’t add the event: ${message(e)}`, { tone: 'error' });
  }
}

/** ⌘C: the event for ⌘V, and as a calendar file for other apps (§7.5). */
export function copyEvent(app: AppController, ref: OccurrenceRef, quiet = false): void {
  const d = detailsOf(app, ref);
  if (!d) return;
  const fields = copyFields(d);
  app.clipboard.value = { fields, calendarId: ref.calendarId };
  const text = eventAsText(fields, `${ref.uid}-copy`, Math.floor(app.now.peek() / 1000));
  const name = fields.title || 'New Event';
  if (!quiet) app.say(`Copied ${name}.`);
  // Other apps get it as a calendar file; when the browser says no, it still pastes here.
  void navigator.clipboard?.writeText(text).catch((e: unknown) => {
    if (!quiet) app.say(`Copied ${name} for Daybird only: ${message(e)}`);
  });
}

/** ⌘X: copies, then deletes (a repeating occurrence asks which ones first). */
export function cutEvent(app: AppController, ref: OccurrenceRef): void {
  copyEvent(app, ref, true);
  deleteEvent(app, ref);
}

/**
 * ⌘V: the copied event at its own clock time on the anchor day, or at `target` (the right-clicked place on the
 * grid) (§7.5).
 */
export function pasteEvent(app: AppController, target: MoveTarget | null = null): void {
  const clip = app.clipboard.peek();
  if (!clip) return;
  const t = { start: clip.fields.start, end: clip.fields.end };
  // A place on the grid is in the display zone; the copy keeps the event's own.
  const zones = new Map<string, never>();
  const times = target
    ? inFrameOf(
        movedTimes(
          inDisplayZone(t, zones, app.displayZone),
          target,
          app.displayZone,
          app.settings.peek().eventMinutes,
        ),
        t.start,
        zones,
        app.displayZone,
      )
    : onDate(t, app.anchor.peek());
  addCopy(app, { ...clip.fields, ...times }, clip.calendarId, 'Paste');
}

/** ⌘D: a copy in place, or one day later in Month, where in place would hide it (§7.5). */
export function duplicateEvent(app: AppController, ref: OccurrenceRef): void {
  const d = detailsOf(app, ref);
  if (!d) return;
  const fields = copyFields(d);
  const times = app.view.peek() === 'month' ? shiftedTimes(fields, { days: 1 }) : fields;
  addCopy(app, { ...fields, start: times.start, end: times.end }, ref.calendarId, 'Duplicate');
}

/** New Event Here, from the menu on empty grid: the default length there, or an all-day event that day. */
export function newEventHere(app: AppController, target: MoveTarget): void {
  const minutes = app.settings.peek().eventMinutes;
  newEventAt(
    app,
    target.kind === 'time'
      ? timedTimes(target.date, target.minute, target.minute + minutes, app.displayZone)
      : allDayTimes(target.date, target.date),
  );
}
