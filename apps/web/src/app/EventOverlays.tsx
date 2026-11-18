/** What floats over the views: the right-click menu on events and empty grid, and the ghost of a drag (§7.3, §12). */
import { PopupMenu, type CommandCatalog } from '@daybird/ui';
import type { AppController } from './controller.ts';
import { EMPTY_MENU, EVENT_MENU } from './eventCommands.ts';

export function EventOverlays({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const menu = app.eventMenu.value;
  const ghost = app.dragGhost.value;
  return (
    <>
      {ghost && (
        <div
          class="db-drag-ghost"
          style={{
            left: `${ghost.left}px`,
            top: `${ghost.top}px`,
            width: `${ghost.width}px`,
            height: `${ghost.height}px`,
            '--db-c': ghost.colour,
          }}
          aria-hidden="true"
        >
          {ghost.label}
        </div>
      )}
      {menu && (
        <PopupMenu
          label={menu.onEvent ? 'Event menu' : 'Calendar grid menu'}
          catalog={catalog}
          items={menu.onEvent ? EVENT_MENU : EMPTY_MENU}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            app.eventMenu.value = null;
          }}
        />
      )}
    </>
  );
}
