import {
  addDays,
  addMonths,
  datePart,
  formatPlainDate,
  isoWeek,
  startOfYear,
  weekday,
  type PlainDate,
} from '@daybird/core';
import type { AppController } from './controller.ts';
import { MiniMonth } from './MiniMonth.tsx';
import { TimeGrid } from './TimeGrid.tsx';

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
        <TimeGrid app={app} />
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
