import { VIEWS, type View } from '@daybird/core';
import { Icon, type CommandCatalog } from '@daybird/ui';
import type { AppController } from './controller.ts';

const VIEW_TITLES: Readonly<Record<View, string>> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year',
  agenda: 'Agenda',
};

/** "Title (key)" for a toolbar tooltip, from the command's first shortcut. */
function tip(catalog: CommandCatalog, id: string, title?: string): string {
  const c = catalog.get(id);
  if (!c) return title ?? id;
  const keys = catalog.keys(c).join(' ');
  return keys ? `${title ?? c.title} (${keys})` : (title ?? c.title);
}

/**
 * The toolbar row (PRD §5.1): sidebar toggle, the range title, ‹ Today ›, then the view switcher. In the
 * desktop app on macOS it is the title bar too, and its empty space drags the window.
 */
export function Toolbar({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  const title = app.title.value;
  const view = app.view.value;
  const sidebar = app.settings.value.sidebarShown;
  return (
    <header class="db-toolbar">
      <button
        type="button"
        class="db-icon-button"
        aria-label={sidebar ? 'Hide sidebar' : 'Show sidebar'}
        aria-pressed={sidebar}
        title={tip(catalog, 'view.sidebar', sidebar ? 'Hide Sidebar' : 'Show Sidebar')}
        onClick={() => catalog.run('view.sidebar')}
      >
        <Icon name="panel-left" />
      </button>
      <h1 class="db-range-title" aria-live="polite">
        {title.main && <strong>{title.main}</strong>} <span>{title.year}</span>
      </h1>
      <div class="db-nav" role="group" aria-label="Move through time">
        <button
          type="button"
          class="db-icon-button"
          aria-label="Previous"
          title={tip(catalog, 'go.previous')}
          onClick={() => catalog.run('go.previous')}
        >
          <Icon name="chevron-left" />
        </button>
        <button
          type="button"
          class="db-button db-today-button"
          title={tip(catalog, 'go.today')}
          onClick={() => catalog.run('go.today')}
        >
          Today
        </button>
        <button
          type="button"
          class="db-icon-button"
          aria-label="Next"
          title={tip(catalog, 'go.next')}
          onClick={() => catalog.run('go.next')}
        >
          <Icon name="chevron-right" />
        </button>
      </div>
      <div class="db-toolbar-space" />
      <div class="db-segmented" role="group" aria-label="View">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            title={tip(catalog, `view.${v}`)}
            onClick={() => catalog.run(`view.${v}`)}
          >
            {VIEW_TITLES[v]}
          </button>
        ))}
      </div>
    </header>
  );
}
