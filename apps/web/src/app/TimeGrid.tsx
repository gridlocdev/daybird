/** Day and Week (PRD §6.1): the all-day strip over a 24-hour time grid, with events laid out in columns. */
import {
  MINUTES_PER_DAY,
  addDays,
  datePart,
  dayBars,
  daySegments,
  formatPlainDate,
  hourLabel,
  isoWeek,
  layoutDay,
  openingMinutes,
  rowCount,
  textOn,
  timeLabel,
  wallMinutes,
  weekday,
  type Bar,
  type Calendar,
  type Occurrence,
  type PlainDate,
  type Placed,
} from '@daybird/core';
import { sameOccurrence, type AppController } from './controller.ts';

/** The all-day strip shows this many rows before "+N more" (§6.1). */
const ALL_DAY_ROWS = 4;
/** A block this many minutes tall shows its time (§5.4)... */
const TIME_ROOM = 30;
/** ...beside the title until it is this tall, then under it. */
const STACK_ROOM = 45;
/** ...and its location from this tall. */
const PLACE_ROOM = 60;
/** The labelled hours: midnight sits at the top edge, so it has none. */
const HOURS = Array.from({ length: 23 }, (_, i) => i + 1);
const HOUR12 = { locale: undefined, '12': true, '24': false } as const;
/** Room above the opening hour for its label. */
const LABEL_ROOM = 10;

const isWeekend = (d: PlainDate) => weekday(d) === 0 || weekday(d) === 6;

function datesIn(start: PlainDate, end: PlainDate): PlainDate[] {
  const out: PlainDate[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function TimeGrid({ app }: { readonly app: AppController }) {
  const { start, end } = app.range.value;
  const today = app.today.value;
  const days = datesIn(start, end);
  const zone = app.displayZone;
  const occurrences = app.occurrences.value;
  const colours = new Map(app.calendars.value.map((c) => [c.id, c]));
  const timed = occurrences.filter((o) => !o.allDay);
  const allDay = occurrences.filter(
    (o): o is Occurrence & { startDate: PlainDate; endDate: PlainDate } =>
      o.allDay && !!o.startDate && !!o.endDate,
  );
  const perDay = daySegments(timed, days, zone).map((segments) => layoutDay(segments));
  const nowSeconds = app.now.value / 1000;
  const todayIndex = days.indexOf(today);
  const nowAt = todayIndex < 0 ? null : wallMinutes(nowSeconds, today, zone);
  const hourHeight = app.settings.value.hourHeight;
  const opening = openingMinutes(nowAt, app.settings.value.firstHour);
  const weekNumbers = app.settings.value.weekNumbers;

  return (
    <div class="db-columns" style={{ '--db-days': days.length }}>
      <div class="db-column-heads">
        <span class="db-gutter db-week-label">{weekNumbers && `W${isoWeek(start)}`}</span>
        {days.map((d) => (
          <div
            key={d}
            class={`db-column-head${d === today ? ' db-today' : ''}${isWeekend(d) ? ' db-weekend' : ''}`}
            aria-current={d === today ? 'date' : undefined}
          >
            <span class="db-weekday">{formatPlainDate(d, app.locale, { weekday: 'short' })}</span>
            <span class="db-day-number">{datePart(d).day}</span>
          </div>
        ))}
      </div>
      <AllDayStrip app={app} days={days} items={allDay} colours={colours} />
      <div
        class="db-column-body"
        // A new range opens at its own hour (§6.1); within one range the scroll stays where the user left it.
        key={`${start}:${hourHeight}`}
        ref={(el) => scrollOnce(el, (opening / 60) * hourHeight - LABEL_ROOM)}
      >
        <div class="db-time-grid">
          <div class="db-gutter db-hours" aria-hidden="true">
            {HOURS.map((h) => (
              <span key={h} class="db-hour-label" style={{ '--db-at': h }}>
                {hourLabel(h, app.locale, HOUR12[app.settings.value.timeFormat])}
              </span>
            ))}
          </div>
          {days.map((d, i) => (
            <div
              key={d}
              class={`db-column${isWeekend(d) ? ' db-weekend' : ''}`}
              role="group"
              aria-label={formatPlainDate(d, app.locale, { weekday: 'long', month: 'long', day: 'numeric' })}
            >
              {perDay[i]!.map((p) => (
                <EventBlock
                  key={`${p.item.calendarId}/${p.item.uid}/${p.item.key ?? ''}`}
                  app={app}
                  placed={p}
                  calendar={colours.get(p.item.calendarId)}
                  past={p.item.end <= nowSeconds}
                />
              ))}
              {i === todayIndex && nowAt !== null && nowAt >= 0 && nowAt < MINUTES_PER_DAY && (
                <div class="db-now" style={{ '--db-at': nowAt / 60 }} aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const scrolled = new WeakSet<HTMLElement>();

function scrollOnce(el: HTMLElement | null, top: number): void {
  if (!el || scrolled.has(el)) return;
  scrolled.add(el);
  el.scrollTop = Math.max(0, top);
}

/** The words a screen reader hears for an event, and the tooltip. */
function describe(app: AppController, o: Occurrence, calendar: Calendar | undefined): string {
  const hour12 = HOUR12[app.settings.peek().timeFormat];
  const when = o.allDay
    ? 'all day'
    : `${timeLabel(o.start, app.locale, app.displayZone, hour12)} to ${timeLabel(o.end, app.locale, app.displayZone, hour12)}`;
  return [o.title || 'New Event', when, o.location, calendar?.name, o.repeating ? 'repeats' : '']
    .filter(Boolean)
    .join(', ');
}

function EventBlock({
  app,
  placed,
  calendar,
  past,
}: {
  readonly app: AppController;
  readonly placed: Placed<Occurrence>;
  readonly calendar: Calendar | undefined;
  readonly past: boolean;
}) {
  const o = placed.item;
  const selected = sameOccurrence(app.selected.value, o);
  const minutes = placed.bottom - placed.top;
  const hour12 = HOUR12[app.settings.value.timeFormat];
  const cls = [
    'db-event',
    past && 'db-past',
    selected && 'db-selected',
    placed.continuesBefore && 'db-continues-before',
    placed.continuesAfter && 'db-continues-after',
    minutes < STACK_ROOM && 'db-short',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      class={cls}
      style={{
        '--db-c': calendar?.color ?? '#8e8f97',
        '--db-top': placed.top / 60,
        '--db-len': minutes / 60,
        left: `${(placed.column / placed.columns) * 100}%`,
        width: `${(placed.span / placed.columns) * 100}%`,
      }}
      aria-label={describe(app, o, calendar)}
      aria-pressed={selected}
      title={describe(app, o, calendar)}
      onClick={() => app.select({ calendarId: o.calendarId, uid: o.uid, key: o.key })}
    >
      <span class="db-event-title">
        {o.title || 'New Event'}
        {o.repeating && <span class="db-repeat"> ↻</span>}
      </span>
      {minutes >= TIME_ROOM && (
        <span class="db-event-time">{timeLabel(o.start, app.locale, app.displayZone, hour12)}</span>
      )}
      {o.location && minutes >= PLACE_ROOM && <span class="db-event-place">{o.location}</span>}
    </button>
  );
}

function AllDayStrip({
  app,
  days,
  items,
  colours,
}: {
  readonly app: AppController;
  readonly days: readonly PlainDate[];
  readonly items: readonly (Occurrence & { startDate: PlainDate; endDate: PlainDate })[];
  readonly colours: ReadonlyMap<string, Calendar>;
}) {
  const bars = dayBars(items, days);
  const rows = rowCount(bars);
  const expanded = app.allDayExpanded.value;
  const fits = rows <= ALL_DAY_ROWS || expanded;
  // Folded, three rows show and the fourth says how many more each day has.
  const shownRows = fits ? Math.max(rows, 1) : ALL_DAY_ROWS;
  const shown = fits ? bars : bars.filter((b) => b.row < ALL_DAY_ROWS - 1);
  const hiddenOn = (i: number) =>
    bars.filter((b) => b.row >= ALL_DAY_ROWS - 1 && b.first <= i && b.last >= i).length;
  return (
    <div class="db-all-day" style={{ '--db-rows': shownRows }}>
      <span class="db-gutter db-all-day-label">
        all-day
        {expanded && rows > ALL_DAY_ROWS && (
          <button type="button" class="db-link-button" onClick={() => (app.allDayExpanded.value = false)}>
            Less
          </button>
        )}
      </span>
      <div class="db-all-day-bars" role="group" aria-label="All-day events">
        {shown.map((b) => (
          <AllDayBar
            key={`${b.item.calendarId}/${b.item.uid}/${b.item.key ?? ''}`}
            app={app}
            bar={b}
            calendar={colours.get(b.item.calendarId)}
          />
        ))}
        {!fits &&
          days.map((d, i) => {
            const n = hiddenOn(i);
            return n > 0 ? (
              <button
                key={d}
                type="button"
                class="db-more"
                style={{ gridColumn: `${i + 1}`, gridRow: `${ALL_DAY_ROWS}` }}
                onClick={() => (app.allDayExpanded.value = true)}
              >
                +{n} more
              </button>
            ) : null;
          })}
      </div>
    </div>
  );
}

function AllDayBar({
  app,
  bar,
  calendar,
}: {
  readonly app: AppController;
  readonly bar: Bar<Occurrence>;
  readonly calendar: Calendar | undefined;
}) {
  const o = bar.item;
  const colour = calendar?.color ?? '#8e8f97';
  const selected = sameOccurrence(app.selected.value, o);
  const cls = [
    'db-bar',
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
        gridRow: `${bar.row + 1}`,
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
