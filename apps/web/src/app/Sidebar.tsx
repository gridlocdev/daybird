import { useState } from 'preact/hooks';
import { addMonths, formatPlainDate, startOfMonth } from '@daybird/core';
import { Icon } from '@daybird/ui';
import type { AppController } from './controller.ts';
import { MiniMonth } from './MiniMonth.tsx';

/**
 * The sidebar (PRD §5.2): a mini month whose arrows page it without moving the view, then the calendars.
 * The calendar list arrives with the store.
 */
export function Sidebar({ app }: { readonly app: AppController }) {
  const anchor = app.anchor.value;
  // The mini month follows the view until its own arrows move it away.
  const [offset, setOffset] = useState<{ from: string; by: number }>({ from: anchor, by: 0 });
  const by = offset.from === anchor ? offset.by : 0;
  const month = addMonths(startOfMonth(anchor), by);
  const width = app.settings.value.sidebarWidth;
  return (
    <aside class="db-sidebar" style={{ width: `${width}px` }} aria-label="Sidebar">
      <div class="db-mini-nav">
        <span class="db-mini-title">
          {formatPlainDate(month, app.locale, { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          class="db-icon-button db-small"
          aria-label="Previous month"
          onClick={() => setOffset({ from: anchor, by: by - 1 })}
        >
          <Icon name="chevron-left" />
        </button>
        <button
          type="button"
          class="db-icon-button db-small"
          aria-label="Next month"
          onClick={() => setOffset({ from: anchor, by: by + 1 })}
        >
          <Icon name="chevron-right" />
        </button>
      </div>
      <MiniMonth
        month={month}
        today={app.today.value}
        weekStart={app.weekStart.value}
        locale={app.locale}
        shaded={app.view.value === 'year' ? undefined : app.range.value}
        onPick={(d) => app.goTo(d)}
      />
      <h2 class="db-sidebar-heading">Calendars</h2>
    </aside>
  );
}
