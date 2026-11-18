/** Pieces every view draws events with (PRD §6): the words for an event, and a bar across days. */
import { textOn, timeLabel, type Bar, type Calendar, type Occurrence } from '@daybird/core';
import { sameOccurrence, type AppController, type OccurrenceRef } from './controller.ts';
import { dragHandlers, justDragged } from './dragMove.ts';
import { openEditor } from './eventActions.ts';

/** How an occurrence is marked in the page, for the popover to sit beside it. */
export const occurrenceKey = (o: OccurrenceRef): string => `${o.calendarId}/${o.uid}/${o.key ?? ''}`;

/** The 12/24-hour setting as the formatter's option: the locale's own when "locale". */
export const HOUR12 = { locale: undefined, '12': true, '24': false } as const;

/** A calendar's colour, grey for one that has gone. */
export const colourOf = (calendar: Calendar | undefined): string => calendar?.color ?? '#8e8f97';

/**
 * What clicking an event does (§6, §7.2, §7.4): the first click selects it, a click on the selected event or a
 * double-click opens the popover. The element is marked so the popover can find it.
 */
export function pickEvent(app: AppController, o: Occurrence) {
  const ref = { calendarId: o.calendarId, uid: o.uid, key: o.key };
  const calendar = app.calendars.peek().find((c) => c.id === o.calendarId);
  return {
    'data-occurrence': occurrenceKey(ref),
    onClick: () => {
      if (justDragged()) return;
      if (sameOccurrence(app.selected.peek(), ref)) openEditor(app, ref);
      else app.select(ref);
    },
    onDblClick: () => openEditor(app, ref),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      app.select(ref);
      app.eventMenu.value = { x: e.clientX, y: e.clientY, onEvent: true, target: null };
    },
    ...dragHandlers(app, o, colourOf(calendar)),
  };
}

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
      {...pickEvent(app, o)}
    >
      {o.title || 'New Event'}
      {o.repeating && ' ↻'}
    </button>
  );
}
