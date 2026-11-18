import { Icon } from '@daybird/ui';
import type { AppController } from './controller.ts';

/** The status bar: the latest notice with its action, read out by a polite live region (PRD §5.5). */
export function StatusBar({ app }: { readonly app: AppController }) {
  const notice = app.notice.value;
  return (
    <footer class="db-status">
      <div class={`db-notice${notice?.tone === 'error' ? ' db-notice-error' : ''}`}>
        {notice && (
          <>
            <span>{notice.text}</span>
            {notice.action && (
              <button
                type="button"
                class="db-link-button"
                onClick={() => {
                  const run = notice.action!.run;
                  app.dismissNotice();
                  run();
                }}
              >
                {notice.action.label}
              </button>
            )}
            {notice.sticky && (
              <button
                type="button"
                class="db-icon-button db-small"
                aria-label="Dismiss"
                onClick={() => app.dismissNotice()}
              >
                <Icon name="x" />
              </button>
            )}
          </>
        )}
      </div>
      <div class="db-live" role="status" aria-live="polite" aria-atomic="true">
        {app.announcement.value}
      </div>
    </footer>
  );
}
