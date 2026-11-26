import { addMonths, countsByDay, startOfYear } from '@daybird/core';
import { AgendaView } from './AgendaView.tsx';
import type { AppController } from './controller.ts';
import { MiniMonth } from './MiniMonth.tsx';
import { MonthView } from './MonthView.tsx';
import { TimeGrid } from './TimeGrid.tsx';

/**
 * The calendar area: the view (PRD §6) over the shown range.
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
        <AgendaView app={app} />
      )}
    </main>
  );
}

function YearGrid({ app }: { readonly app: AppController }) {
  const first = startOfYear(app.anchor.value);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i));
  // Each day tinted by how many events it has (§6.3).
  const counts = countsByDay(app.occurrences.value, app.range.value, app.displayZone);
  return (
    <div class="db-year" data-roving>
      {months.map((m) => (
        <MiniMonth
          key={m}
          month={m}
          today={app.today.value}
          weekStart={app.weekStart.value}
          locale={app.locale}
          heading
          counts={counts}
          tint
          onHeading={() => {
            app.goTo(m);
            app.setView('month');
          }}
          onPick={(d) => app.openDay(d)}
          focus={app.anchor.value}
          onMove={(d) => app.goTo(d)}
          scope={false}
        />
      ))}
    </div>
  );
}
