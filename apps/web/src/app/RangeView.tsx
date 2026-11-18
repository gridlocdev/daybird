import { addDays, addMonths, formatPlainDate, startOfYear } from '@daybird/core';
import type { AppController } from './controller.ts';
import { MiniMonth } from './MiniMonth.tsx';
import { MonthView } from './MonthView.tsx';
import { TimeGrid } from './TimeGrid.tsx';

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
        <MonthView app={app} />
      ) : view === 'year' ? (
        <YearGrid app={app} />
      ) : (
        <Agenda app={app} />
      )}
    </main>
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
          onPick={(d) => app.openDay(d)}
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
