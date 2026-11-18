/** Pieces every view draws events with (PRD §6): the words for an event, and a bar across days. */
import { textOn, timeLabel, type Bar, type Calendar, type Occurrence } from '@daybird/core';
import { sameOccurrence, type AppController } from './controller.ts';

/** The 12/24-hour setting as the formatter's option: the locale's own when "locale". */
export const HOUR12 = { locale: undefined, '12': true, '24': false } as const;

/** A calendar's colour, grey for one that has gone. */
export const colourOf = (calendar: Calendar | undefined): string => calendar?.color ?? '#8e8f97';

/** The words a screen reader hears for an event, and the tooltip. */
export function describe(app: AppController, o: Occurrence, calendar: Calendar | undefined): string {
  const hour12 = HOUR12[app.settings.peek().timeFormat];
  const when = o.allDay
    ? 'all day'
    : `${timeLabel(o.start, app.locale, app.displayZone, hour12)} to ${timeLabel(o.end, app.locale, app.displayZone, hour12)}`;
  return [o.title || 'New Event', when, o.location, calendar?.name, o.repeating ? 'repeats' : '']
    .filter(Boolean)
    .join(', ');
}

/** An all-day or multi-day event across its days, in a grid whose rows are lanes from `firstRow`. */
export function AllDayBar({
  app,
  bar,
  calendar,
  firstRow = 1,
  past = false,
}: {
  readonly app: AppController;
  readonly bar: Bar<Occurrence>;
  readonly calendar: Calendar | undefined;
  readonly firstRow?: number;
  readonly past?: boolean;
}) {
  const o = bar.item;
  const colour = colourOf(calendar);
  const selected = sameOccurrence(app.selected.value, o);
  const cls = [
    'db-bar',
    past && 'db-past',
    selected && 'db-selected',
    bar.continuesBefore && 'db-continues-before',
    bar.continuesAfter && 'db-continues-after',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      class={cls}
      style={{
        background: colour,
        color: textOn(colour),
        gridColumn: `${bar.first + 1} / ${bar.last + 2}`,
        gridRow: `${bar.row + firstRow}`,
      }}
      aria-label={describe(app, o, calendar)}
      aria-pressed={selected}
      title={describe(app, o, calendar)}
      onClick={() => app.select({ calendarId: o.calendarId, uid: o.uid, key: o.key })}
    >
      {o.title || 'New Event'}
      {o.repeating && ' ↻'}
    </button>
  );
}
