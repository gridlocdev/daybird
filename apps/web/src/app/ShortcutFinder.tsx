/** Press a Shortcut (PRD §12): the Keyboard Shortcuts window says what a key press runs. */
import { isMac, type CommandCatalog } from '@daybird/ui';
import type { AppController } from './controller.ts';

/**
 * The finder's row in the Keyboard Shortcuts window. The controller takes the keys (`findKeys`); Escape, the
 * Stop button and closing the window give them back.
 */
export function ShortcutFinder({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  if (!app.findingKey.value)
    return (
      <div class="db-finder">
        <button type="button" class="db-button" onClick={() => app.findKeys(catalog, window)}>
          Press a Shortcut…
        </button>
        <span class="db-finder-hint">Find out what a key does.</span>
      </div>
    );
  const found = app.foundKey.value;
  return (
    <div class="db-finder db-finder-on" role="status" aria-live="polite">
      <div class="db-finder-result">
        {found ? (
          <>
            <span class="db-way">
              {found.keys.map((k, i) => (
                <kbd key={i}>{k}</kbd>
              ))}
            </span>
            <span class={found.none ? 'db-finder-none' : 'db-finder-command'}>{found.text}</span>
          </>
        ) : (
          <span class="db-finder-hint">Press any keys. {isMac ? '⎋' : 'Esc'} stops.</span>
        )}
      </div>
      {/* Focus comes here, inside the window, so Escape reaches the window's own handler. */}
      <button ref={(el) => el?.focus()} type="button" class="db-button" onClick={() => app.stopFindingKey()}>
        Stop
      </button>
    </div>
  );
}
