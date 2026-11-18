import type { CommandCatalog } from '@daybird/ui';
import type { AppController } from './controller.ts';
import { Dialogs } from './Dialogs.tsx';
import { RangeView } from './RangeView.tsx';
import { Sidebar } from './Sidebar.tsx';
import { StatusBar } from './StatusBar.tsx';
import { Toolbar } from './Toolbar.tsx';

/** The window (PRD §5.1): the toolbar row, the sidebar and the view, the status bar. */
export function App({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  const shown = app.settings.value.sidebarShown;
  return (
    <div class="db-app">
      <Toolbar app={app} catalog={catalog} />
      <div class="db-body">
        {shown && <Sidebar app={app} />}
        <RangeView app={app} />
      </div>
      <StatusBar app={app} />
      <Dialogs app={app} catalog={catalog} />
    </div>
  );
}
