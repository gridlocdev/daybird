/**
 * The event popover (PRD §7.2): the one editor, beside the event. Every change saves as it's made and the whole
 * visit is one undo step; a repeating occurrence asks This/Future/All when it closes (§8.2).
 */
import { whenOf, withWhen, type PlainDate, type WhenFields } from '@daybird/core';
import { Dialog } from '@daybird/ui';
import type { AppController, OccurrenceRef } from './controller.ts';
import { colourOf, occurrenceKey } from './eventParts.tsx';
import { RepeatField } from './RepeatDialog.tsx';
import { answerScope, closeEditor, deleteEvent, editEvent, editorDetails } from './eventActions.ts';

const findDrawn = (ref: OccurrenceRef): Element | null =>
  document.querySelector(`[data-occurrence="${CSS.escape(occurrenceKey(ref))}"]`);

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const minutesOf = (text: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Selects the title of a new event once, so typing replaces "New Event" (§7.1). */
function selectOnce(el: HTMLInputElement | null): void {
  if (!el || el.dataset.selected) return;
  el.dataset.selected = '1';
  el.select();
}

export function EventPopover({ app }: { readonly app: AppController }) {
  const ed = app.editor.value;
  const d = editorDetails(app);
  if (!ed || !d) return null;
  const o = d.occurrence;
  const calendars = app.calendars.value;
  const calendar = calendars.find((c) => c.id === d.calendarId);
  const readOnly = !!calendars.find((c) => c.id === ed.ref.calendarId)?.readOnly;
  const when = whenOf(d.start, d.end);
  const setWhen = (change: Partial<WhenFields>) =>
    editEvent(app, withWhen(d.start, d.end, change, app.displayZone, app.settings.peek().eventMinutes));
  const onDate = (field: 'startDate' | 'endDate') => (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).value as PlainDate;
    if (v) setWhen({ [field]: v });
  };
  const onTime = (field: 'startMinute' | 'endMinute') => (e: Event) => {
    const m = minutesOf((e.currentTarget as HTMLInputElement).value);
    if (m !== null) setWhen({ [field]: m });
  };
  const text = (field: 'title' | 'location' | 'url' | 'notes') => (e: Event) =>
    editEvent(app, { [field]: (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value });
  return (
    <Dialog
      title={`Edit ${o.title || 'New Event'}`}
      class="db-event-popover"
      anchor={() => findDrawn(ed.ref)}
      onClose={() => closeEditor(app, 'done')}
      onEscape={() => closeEditor(app, 'escape')}
      actions={
        <>
          {!readOnly && (
            <button type="button" class="db-button db-button-danger" onClick={() => deleteEvent(app, ed.ref)}>
              Delete
            </button>
          )}
          <button type="button" class="db-button db-button-primary" onClick={() => closeEditor(app, 'done')}>
            Done
          </button>
        </>
      }
    >
      <fieldset class="db-popover-fields" disabled={readOnly}>
        <input
          class="db-popover-title"
          aria-label="Title"
          data-autofocus
          ref={ed.fresh ? selectOnce : undefined}
          value={o.title}
          placeholder="New Event"
          onInput={text('title')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.isComposing) {
              e.preventDefault();
              closeEditor(app, 'done');
            }
          }}
        />
        <input
          aria-label="Location"
          placeholder="Add Location"
          value={o.location}
          onInput={text('location')}
        />
        <label class="db-popover-row">
          <span>All-day</span>
          <input
            type="checkbox"
            checked={when.allDay}
            onChange={(e) => setWhen({ allDay: e.currentTarget.checked })}
          />
        </label>
        <div class="db-popover-row">
          <span>Starts</span>
          <input type="date" aria-label="Start date" value={when.startDate} onChange={onDate('startDate')} />
          {!when.allDay && (
            <input
              type="time"
              step={900}
              aria-label="Start time"
              value={hhmm(when.startMinute)}
              onChange={onTime('startMinute')}
            />
          )}
        </div>
        <div class="db-popover-row">
          <span>Ends</span>
          <input type="date" aria-label="End date" value={when.endDate} onChange={onDate('endDate')} />
          {!when.allDay && (
            <input
              type="time"
              step={900}
              aria-label="End time"
              value={hhmm(when.endMinute)}
              onChange={onTime('endMinute')}
            />
          )}
        </div>
        <RepeatField app={app} d={d} />
        <label class="db-popover-row">
          <span>Calendar</span>
          <span class="db-dot" style={{ '--db-c': colourOf(calendar) }} aria-hidden="true" />
          <select value={d.calendarId} onChange={(e) => editEvent(app, {}, e.currentTarget.value)}>
            {calendars
              .filter((c) => !c.readOnly || c.id === d.calendarId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <input type="url" aria-label="URL" placeholder="Add URL" value={o.url} onInput={text('url')} />
        <textarea
          aria-label="Notes"
          placeholder="Add Notes"
          rows={3}
          value={o.notes}
          onInput={text('notes')}
        />
      </fieldset>
      {readOnly && <p class="db-popover-note">This calendar can’t be changed.</p>}
      {d.problems.length > 0 && (
        <ul class="db-popover-problems" aria-label="Couldn’t read">
          {d.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** This Event, This and Future Events, All Events or Cancel, for a change to a repeating event (§8.2). */
export function ScopeDialog({ app }: { readonly app: AppController }) {
  const q = app.scopeQuestion.value;
  if (!q) return null;
  const verb = q.action === 'delete' ? 'delete' : 'change';
  // A new repeat can't be for one occurrence (§8.2): it starts here or covers them all.
  const ruleChange = q.action === 'edit' && q.patch.rule !== undefined;
  const button = (label: string, scope: 'this' | 'future' | 'all', primary = false) => (
    <button
      type="button"
      class={`db-button${primary ? ' db-button-primary' : ''}`}
      data-autofocus={primary || undefined}
      onClick={() => answerScope(app, scope)}
    >
      {label}
    </button>
  );
  return (
    <Dialog
      title={q.action === 'delete' ? 'Delete a repeating event?' : 'Change a repeating event?'}
      onClose={() => answerScope(app, null)}
      actions={
        <>
          <button type="button" class="db-button" onClick={() => answerScope(app, null)}>
            Cancel
          </button>
          {button('All Events', 'all')}
          {button('This and Future Events', 'future', ruleChange)}
          {!ruleChange && button('This Event', 'this', true)}
        </>
      }
    >
      <p>
        {ruleChange
          ? 'Do you want the new repeat to start with this occurrence, or to change every one?'
          : `Do you want to ${verb} only this occurrence, this one and the ones after it, or every one?`}
      </p>
    </Dialog>
  );
}
