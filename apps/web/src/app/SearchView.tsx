import { Icon, type CommandCatalog } from '@daybird/ui';
import { AgendaDay } from './AgendaView.tsx';
import type { AppController } from './controller.ts';
import { SEARCH_FIELD_ID, clearSearch, searchDays, showFirstResult } from './searchActions.ts';

/** The toolbar's search field (PRD §10). Enter shows the first result in its day; Escape clears it. */
export function SearchField({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const keys = catalog.keys(catalog.get('edit.search')!).join(' or ');
  return (
    <label class="db-search">
      <Icon name="search" />
      <input
        id={SEARCH_FIELD_ID}
        type="search"
        aria-label="Search"
        placeholder="Search"
        title={`Search events (${keys})`}
        autocomplete="off"
        spellcheck={false}
        value={app.search.value}
        onInput={(e) => (app.search.value = e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            clearSearch(app);
            e.currentTarget.blur();
          } else if (e.key === 'Enter') {
            showFirstResult(app);
            e.currentTarget.blur();
          } else return;
          e.preventDefault();
        }}
      />
    </label>
  );
}

/** What search found, in Agenda's list, nearest to today first (§10). */
export function SearchView({ app }: { readonly app: AppController }) {
  const query = app.search.value.trim();
  const { days, more } = searchDays(app);
  const calendars = new Map(app.calendars.value.map((c) => [c.id, c]));
  const count = days.reduce((n, d) => n + d.items.length, 0);
  return (
    <main class="db-view db-view-search" aria-label="Search results">
      <div class="db-agenda">
        {days.length === 0 ? (
          <p class="db-empty">
            No events match “{query}”.
            <br />
            <span>Search looks at titles, places and notes, from a year ago to two years ahead.</span>
          </p>
        ) : (
          <p class="db-search-summary" aria-live="polite">
            {more ? `The nearest ${count} results` : `${count} result${count === 1 ? '' : 's'}`} for “{query}
            ”. Press Enter to show the first in its day.
          </p>
        )}
        {days.map((d) => (
          <AgendaDay key={d.date} app={app} date={d.date} items={d.items} calendars={calendars} />
        ))}
      </div>
    </main>
  );
}
