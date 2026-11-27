import {
  TRASH_DAYS,
  formatPlainDate,
  todayIn,
  trashEntries,
  type TimeValue,
  type TrashEntry,
} from '@daybird/core';
import type { JSX } from 'preact';
import type { TrashedCalendar } from '@daybird/ui';
import type { AppController } from './controller.ts';
import { HOUR12 } from './eventParts.tsx';
import { restoreCalendar, restoreEntry, trashCount } from './trashActions.ts';

const KIND_TEXT: Readonly<Record<TrashEntry['kind'], string>> = {
  series: 'Event',
  occurrence: 'One occurrence',
  override: 'One occurrence',
};

/** The Trash view (PRD §7.7): deleted events and calendars, newest first, each with Restore and Delete Permanently. */
export function TrashView({ app }: { readonly app: AppController }) {
  const ws = app.session.value?.workspace.value;
  const readOnly = app.readOnly.value;
  const entries = ws ? trashEntries(ws.trash) : [];
  const names = new Map(app.calendars.value.map((c) => [c.id, c.name]));
  const date = (ms: number) =>
    formatPlainDate(todayIn(ms, app.displayZone), app.locale, { dateStyle: 'medium' });
  const hour12 = HOUR12[app.settings.value.timeFormat];
  /** When the event was: a UTC time in the display zone, any other at its own clock time. */
  const when = (v: TimeValue) => {
    if (v.kind === 'date') return formatPlainDate(v.date, app.locale, { dateStyle: 'medium' });
    const [d = '', t = ''] = v.dateTime.split('T');
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    return new Intl.DateTimeFormat(app.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: v.utc ? app.displayZone : 'UTC',
      ...(hour12 === undefined ? {} : { hour12 }),
    }).format(Date.UTC(y ?? 0, (mo ?? 1) - 1, da ?? 1, h ?? 0, mi ?? 0));
  };
  const rows: { readonly deleted: number; readonly row: JSX.Element }[] = [
    ...entries.map((e) => ({
      deleted: e.deleted * 1000,
      row: (
        <TrashRow
          key={`e-${e.id}`}
          title={e.title || 'New Event'}
          readOnly={readOnly}
          detail={`${KIND_TEXT[e.kind]} on ${when(e.start)} from ${names.get(e.calendarId) ?? e.calendarId.replace(/\.ics$/i, '')}, deleted ${date(e.deleted * 1000)}`}
          onRestore={() => restoreEntry(app, e.id)}
          onDelete={() =>
            (app.trashQuestion.value = { kind: 'entry', id: e.id, title: e.title || 'New Event' })
          }
        />
      ),
    })),
    ...app.trashedCalendars.value.map((t: TrashedCalendar) => ({
      deleted: t.deleted,
      row: (
        <TrashRow
          key={`c-${t.path}`}
          title={t.name}
          readOnly={readOnly}
          detail={`Calendar, deleted ${date(t.deleted)}`}
          onRestore={() => void restoreCalendar(app, t)}
          onDelete={() => (app.trashQuestion.value = { kind: 'calendar', calendar: t })}
        />
      ),
    })),
  ].sort((a, b) => b.deleted - a.deleted);
  return (
    <main class="db-view db-view-trash" aria-label="Trash">
      <div class="db-trash">
        <header class="db-trash-header">
          <h2>Trash</h2>
          <span>Deleted events and calendars stay here {TRASH_DAYS} days.</span>
          <button
            type="button"
            class="db-button"
            disabled={trashCount(app) === 0 || !!readOnly}
            title={readOnly ?? undefined}
            onClick={() => (app.trashQuestion.value = { kind: 'empty' })}
          >
            Empty Trash…
          </button>
        </header>
        {rows.length === 0 ? (
          <p class="db-empty">The trash is empty.</p>
        ) : (
          <ul class="db-trash-list">{rows.map((r) => r.row)}</ul>
        )}
      </div>
    </main>
  );
}

function TrashRow(props: {
  readonly title: string;
  readonly detail: string;
  /** Why the folder can't be changed, when it can't: both buttons are off. */
  readonly readOnly: string | null;
  readonly onRestore: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <li class="db-trash-row" aria-label={props.title}>
      <span class="db-trash-title">{props.title}</span>
      <span class="db-trash-detail">{props.detail}</span>
      <button
        type="button"
        class="db-button"
        disabled={!!props.readOnly}
        title={props.readOnly ?? undefined}
        onClick={props.onRestore}
      >
        Restore
      </button>
      <button
        type="button"
        class="db-button"
        disabled={!!props.readOnly}
        title={props.readOnly ?? undefined}
        onClick={props.onDelete}
      >
        Delete Permanently…
      </button>
    </li>
  );
}
