/**
 * What creating, editing and deleting an event does (PRD §7.1, §7.2, §7.7, §8.2). Every change goes through the
 * folder session as an undo step; the popover's changes join into one.
 */
import { batch } from '@preact/signals';
import {
  calendarById,
  createEvent,
  deleteOccurrence,
  describeRule,
  editOccurrence,
  findOccurrence,
  needsScope,
  nextHalfHour,
  occurrenceDetails,
  timedTimes,
  whenOf,
  type EventPatch,
  type OccurrenceDetails,
  type Scope,
  type TimeValue,
} from '@daybird/core';
import type { AppController, OccurrenceRef } from './controller.ts';

let groups = 0;
const newGroup = () => `popover-${++groups}`;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const titleOf = (app: AppController, ref: OccurrenceRef): string => {
  const calendar = calendarById(app.session.peek()!.workspace.peek(), ref.calendarId);
  const o = calendar && findOccurrence(calendar, ref.uid, ref.key, app.displayZone);
  return o?.title || 'New Event';
};

/** Runs an edit, saying what went wrong instead of throwing (a calendar that went read-only, an event gone). */
function attempt(app: AppController, what: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    app.say(`Couldn’t ${what}: ${message(e)}`, { tone: 'error' });
  }
}

/** A new event in the default calendar, selected, with the popover open on it (§7.1). */
export function newEventAt(app: AppController, times: { start: TimeValue; end: TimeValue }): void {
  const session = app.session.peek();
  const calendar = app.defaultCalendar.peek();
  if (!session) return;
  if (!calendar) {
    app.say('There’s no calendar new events can go to. Add one first.', { tone: 'error' });
    return;
  }
  attempt(app, 'add the event', () => {
    const made = createEvent(session.workspace.peek(), session.editContext(), calendar.id, {
      title: 'New Event',
      ...times,
    });
    const group = newGroup();
    session.commit('New Event', made.workspace, group);
    batch(() => {
      app.select(made.ref);
      app.editor.value = { ref: made.ref, group, fresh: true, draft: null, toCalendar: null };
    });
  });
}

/** ⌘N and N: the next half hour today, or that time on the anchor day when today isn't shown (§7.1). */
export function newEventNow(app: AppController): void {
  const next = nextHalfHour(app.now.peek() / 1000, app.displayZone);
  const date = app.isShowingToday() ? next.date : app.anchor.peek();
  const minutes = app.settings.peek().eventMinutes;
  newEventAt(app, timedTimes(date, next.minute, next.minute + minutes, app.displayZone));
}

/** Opens the popover on an occurrence. */
export function openEditor(app: AppController, ref: OccurrenceRef): void {
  batch(() => {
    app.select(ref);
    app.editor.value = { ref, group: newGroup(), fresh: false, draft: null, toCalendar: null };
  });
}

/** The popover's event as it stands, with a repeating occurrence's held changes on top. */
export function editorDetails(app: AppController): (OccurrenceDetails & { calendarId: string }) | null {
  const ed = app.editor.value;
  const ws = app.session.value?.workspace.value;
  const calendar = ws && ed ? calendarById(ws, ed.ref.calendarId) : null;
  const d = calendar && ed && occurrenceDetails(calendar, ed.ref.uid, ed.ref.key, app.displayZone);
  if (!d || !ed) return null;
  const p = ed.draft ?? {};
  return {
    ...d,
    occurrence: {
      ...d.occurrence,
      title: p.title ?? d.occurrence.title,
      location: p.location ?? d.occurrence.location,
      notes: p.notes ?? d.occurrence.notes,
      url: p.url ?? d.occurrence.url,
    },
    start: p.start ?? d.start,
    end: p.end ?? d.end,
    rule: p.rule !== undefined ? p.rule : d.rule,
    repeat:
      p.rule === undefined
        ? d.repeat
        : p.rule
          ? describeRule(p.rule, whenOf(d.start, d.end).startDate)
          : null,
    calendarId: ed.toCalendar ?? ed.ref.calendarId,
  };
}

/**
 * A change from the popover. A single event changes at once, joining the popover's undo step; a repeating
 * occurrence holds the change until the popover closes (§8.2).
 */
export function editEvent(app: AppController, patch: EventPatch, toCalendar?: string): void {
  const ed = app.editor.peek();
  const session = app.session.peek();
  if (!ed || !session) return;
  const ws = session.workspace.peek();
  if (needsScope(ws, ed.ref)) {
    app.editor.value = {
      ...ed,
      fresh: false,
      draft: { ...ed.draft, ...patch },
      toCalendar: toCalendar ?? ed.toCalendar,
    };
    return;
  }
  attempt(app, 'change the event', () => {
    const r = editOccurrence(
      ws,
      session.editContext(),
      ed.ref,
      patch,
      'all',
      toCalendar ?? ed.ref.calendarId,
    );
    session.commit(`Edit ${patch.title ?? titleOf(app, ed.ref)}`, r.workspace, ed.group);
    batch(() => {
      app.editor.value = { ...ed, ref: r.ref, fresh: false };
      app.select(r.ref);
    });
  });
}

/**
 * Closes the popover. Escape on a new event nobody changed takes it away, with no Trash entry and nothing to
 * undo (§7.1); a repeating occurrence with held changes asks which occurrences they're for (§8.2).
 */
export function closeEditor(app: AppController, how: 'escape' | 'done'): void {
  const ed = app.editor.peek();
  if (!ed) return;
  batch(() => {
    app.editor.value = null;
    if (how === 'escape' && ed.fresh && app.session.peek()?.retract(ed.group)) app.select(null);
    else if ((ed.draft && Object.keys(ed.draft).length) || ed.toCalendar)
      app.scopeQuestion.value = {
        action: 'edit',
        ref: ed.ref,
        patch: ed.draft ?? {},
        toCalendar: ed.toCalendar,
      };
  });
}

/** Delete: to the Trash, with Undo in the notice (§7.7). A repeating occurrence asks first (§8.2). */
export function deleteEvent(app: AppController, ref: OccurrenceRef): void {
  const session = app.session.peek();
  if (!session) return;
  app.editor.value = null;
  if (needsScope(session.workspace.peek(), ref)) app.scopeQuestion.value = { action: 'delete', ref };
  else deleteWith(app, ref, 'all');
}

function deleteWith(app: AppController, ref: OccurrenceRef, scope: Scope): void {
  const session = app.session.peek()!;
  const title = titleOf(app, ref);
  attempt(app, 'delete the event', () => {
    const next = deleteOccurrence(session.workspace.peek(), session.editContext(), ref, scope);
    if (!session.commit(`Delete ${title}`, next)) return;
    app.select(null);
    app.say(`Deleted ${title}.`, { action: { label: 'Undo', run: () => app.undo() } });
  });
}

/** The answer to This/Future/All; null is Cancel, which drops the held changes. */
export function answerScope(app: AppController, scope: Scope | null): void {
  const q = app.scopeQuestion.peek();
  const session = app.session.peek();
  app.scopeQuestion.value = null;
  if (!q || !scope || !session) return;
  if (q.action === 'delete') {
    deleteWith(app, q.ref, scope);
    return;
  }
  attempt(app, 'change the event', () => {
    const r = editOccurrence(
      session.workspace.peek(),
      session.editContext(),
      q.ref,
      q.patch,
      scope,
      q.toCalendar ?? q.ref.calendarId,
    );
    session.commit(`Edit ${q.patch.title ?? titleOf(app, q.ref)}`, r.workspace);
    app.select(r.ref);
  });
}
