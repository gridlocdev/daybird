import type { CommandCatalog } from '@daybird/ui';
import type { AppController } from './controller.ts';
import { Dialogs } from './Dialogs.tsx';
import { EventOverlays } from './EventOverlays.tsx';
import { RangeView } from './RangeView.tsx';
import { SearchView } from './SearchView.tsx';
import { Sidebar } from './Sidebar.tsx';
import { StatusBar } from './StatusBar.tsx';
import { Toolbar } from './Toolbar.tsx';
import { TrashView } from './TrashView.tsx';

/** The window (PRD §5.1): the toolbar row, the sidebar and the view, the status bar. */
export function App({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  const shown = app.settings.value.sidebarShown;
  return (
    <div class="db-app">
      <Toolbar app={app} catalog={catalog} />
      <div class="db-body">
        {shown && <Sidebar app={app} catalog={catalog} />}
        {app.search.value.trim() ? (
          <SearchView app={app} />
        ) : app.trashShown.value ? (
          <TrashView app={app} />
        ) : (
          <RangeView app={app} />
        )}
      </div>
      <StatusBar app={app} />
      <EventOverlays app={app} catalog={catalog} />
      <Dialogs app={app} catalog={catalog} />
    </div>
  );
}
