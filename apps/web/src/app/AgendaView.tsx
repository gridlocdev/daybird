import { useMemo, useState } from 'preact/hooks';
import {
  AGENDA_DAYS,
  addDays,
  agendaDays,
  dayBounds,
  formatPlainDate,
  timeLabel,
  type Calendar,
  type Occurrence,
  type PlainDate,
} from '@daybird/core';
import { sameOccurrence, type AppController } from './controller.ts';
import { HOUR12, colourOf, describe, pickEvent } from './eventParts.tsx';

/**
 * Agenda (PRD §6.4): the days from the anchor that have events, under sticky headings, 60 days at a time. Scrolling
 * to the end loads the next 60; **Show Earlier** loads the 60 before, faded once they are over. A new anchor
 * (‹ ›, Today, a picked day) starts the list again at that day.
 */
export function AgendaView({ app }: { readonly app: AppController }) {
  const anchor = app.anchor.value;
  return <AgendaList key={anchor} app={app} anchor={anchor} />;
}

function AgendaList({ app, anchor }: { readonly app: AppController; readonly anchor: PlainDate }) {
  const [back, setBack] = useState(0);
  const [ahead, setAhead] = useState(1);
  const range = { start: addDays(anchor, -back * AGENDA_DAYS), end: addDays(anchor, ahead * AGENDA_DAYS) };
  const from = dayBounds(range.start, app.displayZone).start;
  const to = dayBounds(addDays(range.end, -1), app.displayZone).end;
  const days = agendaDays(app.occurrencesBetween(from, to), range, app.displayZone);
  const calendars = new Map(app.calendars.value.map((c) => [c.id, c]));
  const coming = days.filter((d) => d.date >= anchor);
  const reaches = formatPlainDate(addDays(range.end, -1), app.locale, { dateStyle: 'long' });
  // Reaching the end of the list loads the next 60 days. A load that adds nothing leaves the end where it is,
  // so it stops by itself.
  const watchEnd = useMemo(() => endWatcher(() => setAhead((n) => n + 1)), []);
  const more = () => setAhead((n) => n + 1);
  return (
    <div class="db-agenda">
      <div class="db-agenda-edge">
        <button type="button" class="db-button" onClick={() => setBack((n) => n + 1)}>
          Show Earlier
        </button>
      </div>
      {days
        .filter((d) => d.date < anchor)
        .map((d) => (
          <AgendaDay key={d.date} app={app} date={d.date} items={d.items} calendars={calendars} />
        ))}
      {coming.length === 0 && (
        <p class="db-empty">
          No events in the next {ahead * AGENDA_DAYS} days.
          <br />
          <span>The list reaches {reaches}.</span>
        </p>
      )}
      {coming.map((d) => (
        <AgendaDay key={d.date} app={app} date={d.date} items={d.items} calendars={calendars} />
      ))}
      <div class="db-agenda-edge" ref={watchEnd}>
        <span class="db-agenda-reach">Up to {reaches}</span>
        <button type="button" class="db-button" onClick={more}>
          Show {AGENDA_DAYS} More Days
        </button>
      </div>
    </div>
  );
}

/** A ref callback that calls `onSeen` each time the element scrolls into view. */
function endWatcher(onSeen: () => void): (el: HTMLElement | null) => void {
  let observer: IntersectionObserver | null = null;
  return (el) => {
    observer?.disconnect();
    observer = null;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let first = true;
    observer = new IntersectionObserver((entries) => {
      // The first report is where the end is when the list opens; only scrolling to it loads more.
      if (first) {
        first = false;
        return;
      }
      if (entries.some((e) => e.isIntersecting)) onSeen();
    });
    observer.observe(el);
  };
}

function AgendaDay(props: {
  readonly app: AppController;
  readonly date: PlainDate;
  readonly items: readonly Occurrence[];
  readonly calendars: ReadonlyMap<string, Calendar>;
}) {
  const { app, date } = props;
  const heading = dayHeading(app, date);
  return (
    <section class="db-agenda-day" aria-label={heading}>
      <h2 class={`db-agenda-heading${date === app.today.value ? ' db-today' : ''}`}>{heading}</h2>
      <ul>
        {props.items.map((o) => (
          <AgendaRow
            key={`${o.calendarId}/${o.uid}/${o.key ?? ''}`}
            app={app}
            item={o}
            date={date}
            calendar={props.calendars.get(o.calendarId)}
          />
        ))}
      </ul>
    </section>
  );
}

function AgendaRow(props: {
  readonly app: AppController;
  readonly item: Occurrence;
  readonly date: PlainDate;
  readonly calendar: Calendar | undefined;
}) {
  const { app, item: o } = props;
  const selected = sameOccurrence(app.selected.value, o);
  const past = o.end <= app.now.value / 1000;
  return (
    <li>
      <button
        type="button"
        class={`db-agenda-row${past ? ' db-past' : ''}${selected ? ' db-selected' : ''}`}
        aria-label={describe(app, o, props.calendar)}
        aria-pressed={selected}
        {...pickEvent(app, o)}
      >
        <span class="db-agenda-time">{whenOn(app, o, props.date)}</span>
        <span class="db-dot" style={{ background: colourOf(props.calendar) }} />
        <span class="db-agenda-title">
          {o.title || 'New Event'}
          {o.repeating && ' ↻'}
        </span>
        {o.location && <span class="db-agenda-location">{o.location}</span>}
      </button>
    </li>
  );
}

/** "9:00 AM – 10:00 AM" on the day it starts, "Until 2:00 AM" on the day it ends, "All day" between. */
function whenOn(app: AppController, o: Occurrence, date: PlainDate): string {
  if (o.allDay) return 'All day';
  const hour12 = HOUR12[app.settings.peek().timeFormat];
  const day = dayBounds(date, app.displayZone);
  const time = (utc: number) => timeLabel(utc, app.locale, app.displayZone, hour12);
  if (o.start >= day.start) return `${time(o.start)} – ${time(o.end)}`;
  if (o.end <= day.end) return `Until ${time(o.end)}`;
  return 'All day';
}

/** "Today", "Tomorrow", "Yesterday", else "Thursday, November 19" (with the year when it isn't this one). */
function dayHeading(app: AppController, date: PlainDate): string {
  const today = app.today.value;
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  const year = date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' as const };
  return formatPlainDate(date, app.locale, { weekday: 'long', month: 'long', day: 'numeric', ...year });
}
