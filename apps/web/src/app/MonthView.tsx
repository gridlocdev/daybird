/** Month (PRD §6.2): whole weeks, bars across days, one line per timed event and "N more" where a day overflows. */
import { useMemo } from 'preact/hooks';
import {
  addDays,
  datePart,
  formatPlainDate,
  isoWeek,
  layoutMonthWeek,
  timeLabel,
  weekday,
  type Calendar,
  type Occurrence,
  type PlainDate,
} from '@daybird/core';
import { sameOccurrence, type AppController } from './controller.ts';
import { AllDayBar, HOUR12, colourOf, describe } from './eventParts.tsx';

/** The day number's row and each lane, in px; the CSS takes them from here. */
const HEAD = 26;
const LANE = 20;

const isWeekend = (d: PlainDate) => weekday(d) === 0 || weekday(d) === 6;

/**
 * Watches the weeks' height and keeps `monthLanes` at what fits in a cell. A ref callback, not an effect: it
 * runs when the element arrives and with null when it goes.
 */
function laneWatcher(app: AppController): (el: HTMLElement | null) => void {
  let observer: ResizeObserver | null = null;
  return (el) => {
    observer?.disconnect();
    observer = null;
    if (!el) return;
    const measure = () => {
      const weeks = Math.max(1, el.children.length);
      const lanes = Math.max(1, Math.floor((el.clientHeight / weeks - HEAD) / LANE));
      if (app.monthLanes.peek() !== lanes) app.monthLanes.value = lanes;
    };
    observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
  };
}

export function MonthView({ app }: { readonly app: AppController }) {
  const { start, end } = app.range.value;
  const today = app.today.value;
  const { month } = datePart(app.anchor.value);
  const weeks: PlainDate[][] = [];
  for (let d = start; d < end; d = addDays(d, 7))
    weeks.push(Array.from({ length: 7 }, (_, j) => addDays(d, j)));
  const watch = useMemo(() => laneWatcher(app), [app]);
  const lanes = app.monthLanes.value;
  const occurrences = app.occurrences.value;
  const colours = new Map(app.calendars.value.map((c) => [c.id, c]));
  const nowSeconds = app.now.value / 1000;
  const weekNumbers = app.settings.value.weekNumbers;
  return (
    <div class="db-month" style={{ '--db-lane': `${LANE}px`, '--db-month-head': `${HEAD}px` }}>
      <div class="db-month-heads">
        {weeks[0]!.map((d) => (
          <span key={d} class="db-weekday">
            {formatPlainDate(d, app.locale, { weekday: 'short' })}
          </span>
        ))}
      </div>
      <div class="db-month-weeks" ref={watch}>
        {weeks.map((days) => {
          const layout = layoutMonthWeek(occurrences, days, app.displayZone, lanes);
          return (
            <div key={days[0]} class="db-month-week" style={{ '--db-lanes': lanes }}>
              {days.map((d, i) => {
                const { day, month: m } = datePart(d);
                const cls = [
                  'db-month-cell',
                  m !== month && 'db-outside',
                  isWeekend(d) && 'db-weekend',
                  d === today && 'db-today',
                ]
                  .filter(Boolean)
                  .join(' ');
                const label = formatPlainDate(d, app.locale, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                });
                return (
                  <div
                    key={d}
                    class={cls}
                    style={{ gridColumn: `${i + 1}` }}
                    aria-current={d === today ? 'date' : undefined}
                  >
                    {weekNumbers && i === 0 && <span class="db-week-number">{isoWeek(d)}</span>}
                    <button
                      type="button"
                      class="db-day-number"
                      aria-label={`${label}, ${count(layout.days[i]!.length)}`}
                      title="Show in Day view"
                      onClick={() => app.openDay(d)}
                    >
                      {day === 1 ? formatPlainDate(d, app.locale, { month: 'short', day: 'numeric' }) : day}
                    </button>
                  </div>
                );
              })}
              {layout.bars.map((b) => (
                <AllDayBar
                  key={`${b.item.calendarId}/${b.item.uid}/${b.item.key ?? ''}`}
                  app={app}
                  bar={b}
                  calendar={colours.get(b.item.calendarId)}
                  firstRow={2}
                  past={b.item.end <= nowSeconds}
                />
              ))}
              {layout.lines.map((l) => (
                <MonthLine
                  key={`${l.item.calendarId}/${l.item.uid}/${l.item.key ?? ''}`}
                  app={app}
                  item={l.item}
                  calendar={colours.get(l.item.calendarId)}
                  column={l.day + 1}
                  row={l.lane + 2}
                  past={l.item.end <= nowSeconds}
                />
              ))}
              {layout.more.map((m) => (
                <button
                  key={`more-${m.day}`}
                  type="button"
                  class="db-more"
                  style={{ gridColumn: `${m.day + 1}`, gridRow: `${m.lane + 2}` }}
                  aria-haspopup="dialog"
                  onClick={() => (app.dayList.value = days[m.day]!)}
                >
                  {m.count} more
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const count = (n: number) => (n === 0 ? 'no events' : n === 1 ? '1 event' : `${n} events`);

/** A timed event in a Month cell: a dot in its calendar's colour, the start time and the title. */
export function MonthLine({
  app,
  item,
  calendar,
  column,
  row,
  past,
}: {
  readonly app: AppController;
  readonly item: Occurrence;
  readonly calendar: Calendar | undefined;
  readonly column: number;
  readonly row: number;
  readonly past: boolean;
}) {
  const selected = sameOccurrence(app.selected.value, item);
  const hour12 = HOUR12[app.settings.value.timeFormat];
  return (
    <button
      type="button"
      class={`db-line${past ? ' db-past' : ''}${selected ? ' db-selected' : ''}`}
      style={{ gridColumn: `${column}`, gridRow: `${row}`, '--db-c': colourOf(calendar) }}
      aria-label={describe(app, item, calendar)}
      aria-pressed={selected}
      title={describe(app, item, calendar)}
      onClick={() => app.select({ calendarId: item.calendarId, uid: item.uid, key: item.key })}
    >
      <span class="db-dot" aria-hidden="true" />
      <span class="db-line-time">{timeLabel(item.start, app.locale, app.displayZone, hour12)}</span>
      <span class="db-line-title">{item.title || 'New Event'}</span>
    </button>
  );
}
