/** "N more" in Month view (PRD §6.2): every event on one day, so none is out of reach. */
import { formatPlainDate, itemsOnDay, timeLabel, type PlainDate } from '@daybird/core';
import { Dialog } from '@daybird/ui';
import { sameOccurrence, type AppController } from './controller.ts';
import { HOUR12, colourOf, describe } from './eventParts.tsx';

export function DayListDialog({ app, day }: { readonly app: AppController; readonly day: PlainDate }) {
  const items = itemsOnDay(app.occurrences.value, day, app.displayZone);
  const colours = new Map(app.calendars.value.map((c) => [c.id, c]));
  const hour12 = HOUR12[app.settings.value.timeFormat];
  const close = () => (app.dayList.value = null);
  return (
    <Dialog
      title={formatPlainDate(day, app.locale, { weekday: 'long', month: 'long', day: 'numeric' })}
      class="db-day-list"
      onClose={close}
      actions={
        <>
          <button type="button" class="db-button" onClick={() => app.openDay(day)}>
            Show Day
          </button>
          <button type="button" class="db-button db-button-primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <ul class="db-day-list-items">
        {items.map((o) => {
          const calendar = colours.get(o.calendarId);
          const selected = sameOccurrence(app.selected.value, o);
          return (
            <li key={`${o.calendarId}/${o.uid}/${o.key ?? ''}`}>
              <button
                type="button"
                class="db-line"
                style={{ '--db-c': colourOf(calendar) }}
                aria-label={describe(app, o, calendar)}
                aria-pressed={selected}
                onClick={() => {
                  app.select({ calendarId: o.calendarId, uid: o.uid, key: o.key });
                  close();
                }}
              >
                <span class="db-dot" aria-hidden="true" />
                <span class="db-line-time">
                  {o.allDay ? 'All day' : timeLabel(o.start, app.locale, app.displayZone, hour12)}
                </span>
                <span class="db-line-title">{o.title || 'New Event'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
