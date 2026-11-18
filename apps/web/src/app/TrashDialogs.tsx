import { useState } from 'preact/hooks';
import { trashEntries } from '@daybird/core';
import { Dialog } from '@daybird/ui';
import type { AppController, ImportOffer, TrashQuestion } from './controller.ts';
import { importInto } from './importExport.ts';
import { deleteCalendarFile, deleteEntry, emptyAll } from './trashActions.ts';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Delete Permanently and Empty Trash ask first (PRD §7.7). */
export function TrashQuestionDialog({ app, q }: { readonly app: AppController; readonly q: TrashQuestion }) {
  const close = () => (app.trashQuestion.value = null);
  const ws = app.session.value?.workspace.value;
  const events = ws ? trashEntries(ws.trash).length : 0;
  const calendars = app.trashedCalendars.value.length;
  let title: string;
  let body: string;
  let run: () => void;
  switch (q.kind) {
    case 'empty': {
      const parts = [events && plural(events, 'event'), calendars && plural(calendars, 'calendar')].filter(
        Boolean,
      );
      title = 'Empty Trash?';
      body = `${parts.join(' and ')} will be deleted for good.${calendars ? ' Deleted calendars can’t be brought back.' : ''}`;
      run = () => void emptyAll(app);
      break;
    }
    case 'entry':
      title = `Delete ${q.title} permanently?`;
      body = `${q.title} will be gone from the Trash.`;
      run = () => deleteEntry(app, q.id);
      break;
    case 'calendar':
      title = `Delete ${q.calendar.name} permanently?`;
      body = `The calendar’s file will be deleted for good. This can’t be undone.`;
      run = () => void deleteCalendarFile(app, q.calendar);
      break;
  }
  return (
    <Dialog
      title={title}
      onClose={close}
      onSubmit={() => {
        close();
        run();
      }}
      actions={
        <>
          <button type="button" class="db-button" onClick={close} data-autofocus>
            Cancel
          </button>
          <button type="submit" class="db-button db-button-danger">
            {q.kind === 'empty' ? 'Empty Trash' : 'Delete'}
          </button>
        </>
      }
    >
      <p>{body}</p>
    </Dialog>
  );
}

const NEW = '';

/** Import: which calendar takes the file's events, or a new one named after the file (PRD §11). */
export function ImportDialog({ app, offer }: { readonly app: AppController; readonly offer: ImportOffer }) {
  const writable = app.calendars.value.filter((c) => !c.readOnly);
  const [choice, setChoice] = useState(app.defaultCalendar.value?.id ?? NEW);
  const close = () => (app.importOffer.value = null);
  const newName = offer.fileName.replace(/\.ics$/i, '');
  return (
    <Dialog
      title={`Import ${offer.fileName}`}
      onClose={close}
      onSubmit={() => void importInto(app, offer, choice === NEW ? null : choice)}
      actions={
        <>
          <button type="button" class="db-button" onClick={close}>
            Cancel
          </button>
          <button type="submit" class="db-button db-button-primary">
            Import
          </button>
        </>
      }
    >
      <p>{plural(offer.count, 'event')} to add. Events already in the calendar are skipped.</p>
      <label class="db-field">
        <span>Add to</span>
        <select
          data-autofocus
          aria-label="Add to"
          value={choice}
          onChange={(e) => setChoice(e.currentTarget.value)}
        >
          {writable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW}>New Calendar “{newName}”</option>
        </select>
      </label>
    </Dialog>
  );
}
