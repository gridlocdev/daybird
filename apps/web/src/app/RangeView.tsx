import {
  addDays,
  addMonths,
  datePart,
  formatPlainDate,
  hourLabel,
  isoWeek,
  startOfYear,
  weekday,
  type PlainDate,
} from '@daybird/core';
import type { AppController } from './controller.ts';
import { MiniMonth } from './MiniMonth.tsx';

function datesIn(start: PlainDate, end: PlainDate): PlainDate[] {
  const out: PlainDate[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) out.push(d);
  return out;
}

const isWeekend = (d: PlainDate) => weekday(d) === 0 || weekday(d) === 6;

/**
 * The calendar area: the frame of each view (PRD §6) over the shown range. The time grid, month bars and
 * the agenda list fill it in as events arrive.
 */
export function RangeView({ app }: { readonly app: AppController }) {
  const view = app.view.value;
  return (
    <main class={`db-view db-view-${view}`} aria-label={`${view[0]!.toUpperCase()}${view.slice(1)} view`}>
      {view === 'day' || view === 'week' ? (
        <DayColumns app={app} />
      ) : view === 'month' ? (
        <MonthGrid app={app} />
      ) : view === 'year' ? (
        <YearGrid app={app} />
      ) : (
        <Agenda app={app} />
      )}
    </main>
  );
}

function DayColumns({ app }: { readonly app: AppController }) {
  const { start, end } = app.range.value;
  const today = app.today.value;
  const days = datesIn(start, end);
  return (
    <div class="db-columns" style={{ '--db-days': days.length }}>
      <div class="db-column-heads">
        <span class="db-gutter" />
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
      <div
        class="db-column-body"
        ref={(el) => scrollToFirstHour(el, app.settings.value.firstHour * app.settings.value.hourHeight)}
      >
        <div class="db-time-grid">
          <div class="db-gutter db-hours" aria-hidden="true">
            {HOURS.map((h) => (
              <span key={h} class="db-hour-label" style={{ '--db-at': h }}>
                {hourLabel(h, app.locale, HOUR12[app.settings.value.timeFormat])}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} class={`db-column${isWeekend(d) ? ' db-weekend' : ''}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The labelled hours: midnight sits at the top edge, so it has none. */
const HOURS = Array.from({ length: 23 }, (_, i) => i + 1);

const HOUR12 = { locale: undefined, '12': true, '24': false } as const;

const scrolled = new WeakSet<HTMLElement>();

/**
 * Opening the time grid shows the first-hour setting at the top (§6.1), with room for its label; after that the
 * scroll stays put.
 */
function scrollToFirstHour(el: HTMLElement | null, top: number): void {
  if (!el || scrolled.has(el)) return;
  scrolled.add(el);
  el.scrollTop = top - LABEL_ROOM;
}

const LABEL_ROOM = 10;

function MonthGrid({ app }: { readonly app: AppController }) {
  const { start, end } = app.range.value;
  const today = app.today.value;
  const { month } = datePart(app.anchor.value);
  const days = datesIn(start, end);
  const weekNumbers = app.settings.value.weekNumbers;
  return (
    <div class="db-month" style={{ '--db-weeks': days.length / 7 }}>
      <div class="db-month-heads">
        {days.slice(0, 7).map((d) => (
          <span key={d} class="db-weekday">
            {formatPlainDate(d, app.locale, { weekday: 'short' })}
          </span>
        ))}
      </div>
      <div class="db-month-cells">
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
          return (
            <div key={d} class={cls} aria-current={d === today ? 'date' : undefined}>
              {weekNumbers && i % 7 === 0 && <span class="db-week-number">{isoWeek(d)}</span>}
              <span class="db-day-number">
                {day === 1 ? formatPlainDate(d, app.locale, { month: 'short', day: 'numeric' }) : day}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function YearGrid({ app }: { readonly app: AppController }) {
  const first = startOfYear(app.anchor.value);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i));
  return (
    <div class="db-year">
      {months.map((m) => (
        <MiniMonth
          key={m}
          month={m}
          today={app.today.value}
          weekStart={app.weekStart.value}
          locale={app.locale}
          heading
          onHeading={() => {
            app.goTo(m);
            app.setView('month');
          }}
          onPick={(d) => {
            app.goTo(d);
            app.setView('day');
          }}
        />
      ))}
    </div>
  );
}

function Agenda({ app }: { readonly app: AppController }) {
  const { end } = app.range.value;
  const last = formatPlainDate(addDays(end, -1), app.locale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return (
    <div class="db-agenda">
      <p class="db-empty">
        No events in the next 60 days.
        <br />
        <span>The list reaches {last}.</span>
      </p>
    </div>
  );
}
