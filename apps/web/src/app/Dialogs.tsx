import { useMemo, useState } from 'preact/hooks';
import { ACCENTS, type Accent } from '@daybird/core';
import {
  Dialog,
  ListPopup,
  THEMES,
  filterEntries,
  isMac,
  type CommandCatalog,
  type MenuEntry,
  type Theme,
  type WeekStartSetting,
} from '@daybird/ui';
import type { AppController } from './controller.ts';
import { ConflictDialog, RecoveryDialog } from './FolderDialogs.tsx';
import { shortcutGroups } from './shortcuts.ts';

/** The open dialog, if any. One at a time; a question about the folder comes before any other. */
export function Dialogs({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  const session = app.session.value;
  const recovery = session?.recovery.value;
  if (session && recovery) return <RecoveryDialog session={session} offer={recovery} />;
  const conflict = session?.conflicts.value[0];
  if (session && conflict) return <ConflictDialog app={app} session={session} conflict={conflict} />;
  switch (app.dialog.value) {
    case 'commands':
      return <CommandMenu app={app} catalog={catalog} />;
    case 'shortcuts':
      return <ShortcutsDialog app={app} catalog={catalog} />;
    case 'settings':
      return <SettingsDialog app={app} />;
    case null:
      return null;
  }
}

interface Entry extends MenuEntry {
  readonly keys: string;
  readonly enabled: boolean;
}

/** ⌘K: every command, recent ones first (PRD §12). */
function CommandMenu({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const entries = useMemo<Entry[]>(
    () =>
      catalog.all
        .filter((c) => !c.hidden && c.id !== 'help.commands')
        .map((c) => ({
          id: c.id,
          title: c.title,
          group: c.group,
          keywords: `${c.keywords ?? ''} ${c.description}`,
          keys: catalog.keys(c).join(' '),
          enabled: catalog.isEnabled(c),
        })),
    [catalog],
  );
  const results = filterEntries(entries, query, catalog.recentIds).slice(0, 80);
  const pick = (i: number) => {
    const entry = results[i];
    if (!entry?.enabled) return;
    app.close();
    // Let the menu close (and focus go back) before the command runs.
    queueMicrotask(() => catalog.run(entry.id));
  };
  return (
    <ListPopup
      label="Command menu"
      placeholder="Type a command…"
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setIndex(0);
      }}
      index={index}
      onIndex={setIndex}
      count={results.length}
      onPick={pick}
      onClose={() => app.close()}
    >
      {results.map((e, i) => (
        <li
          key={e.id}
          id={`db-palette-${i}`}
          role="option"
          aria-selected={i === index}
          aria-disabled={!e.enabled}
          class={e.enabled ? undefined : 'db-disabled'}
          onPointerMove={() => setIndex(i)}
          onClick={() => pick(i)}
        >
          <span class="db-palette-title">{e.title}</span>
          <span class="db-palette-group">{e.group}</span>
          {e.keys && <kbd>{e.keys}</kbd>}
        </li>
      ))}
    </ListPopup>
  );
}

/** ⌘/: every shortcut, made from the catalog (PRD §12). */
function ShortcutsDialog({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const groups = shortcutGroups(catalog, isMac);
  return (
    <Dialog
      title="Keyboard Shortcuts"
      class="db-dialog-wide"
      onClose={() => app.close()}
      actions={
        <button type="button" class="db-button db-button-primary" onClick={() => app.close()}>
          Close
        </button>
      }
    >
      <div class="db-shortcuts">
        {groups.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.lines.map((l) => (
                <div key={l.title} class="db-shortcut">
                  <dt>{l.title}</dt>
                  <dd>
                    {l.keys.map((way, i) => (
                      <span key={i} class="db-way">
                        {i > 0 && <span class="db-or">or</span>}
                        {way.map((k, j) => (
                          <kbd key={j}>{k}</kbd>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

const THEME_TITLES: Readonly<Record<Theme, string>> = { auto: 'Auto', light: 'Light', dark: 'Dark' };

const WEEK_STARTS: readonly { value: WeekStartSetting; label: string }[] = [
  { value: 'locale', label: 'Region default' },
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 6, label: 'Saturday' },
];

/**
 * Settings (PRD §13). Every change applies at once and is kept; there is nothing to save or cancel.
 * Settings join this window as the features they change arrive.
 */
function SettingsDialog({ app }: { readonly app: AppController }) {
  const s = app.settings.value;
  return (
    <Dialog
      title="Settings"
      onClose={() => app.close()}
      actions={
        <button type="button" class="db-button db-button-primary" onClick={() => app.close()}>
          Done
        </button>
      }
    >
      <div class="db-field">
        <span id="db-theme-label">Appearance</span>
        <div class="db-segmented" role="radiogroup" aria-labelledby="db-theme-label">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={s.theme === t}
              onClick={() => app.setTheme(t)}
            >
              {THEME_TITLES[t]}
            </button>
          ))}
        </div>
      </div>
      <div class="db-field">
        <span id="db-accent-label">Accent colour</span>
        <div class="db-swatches" role="radiogroup" aria-labelledby="db-accent-label">
          {ACCENTS.map((a: Accent) => (
            <button
              key={a}
              type="button"
              role="radio"
              class="db-swatch"
              data-accent-swatch={a}
              aria-checked={s.accent === a}
              aria-label={a[0]!.toUpperCase() + a.slice(1)}
              title={a[0]!.toUpperCase() + a.slice(1)}
              onClick={() => app.setAccent(a)}
            />
          ))}
        </div>
      </div>
      <label class="db-field">
        <span>Week starts on</span>
        <select
          value={String(s.weekStart)}
          onChange={(e) => {
            const v = e.currentTarget.value;
            app.update({ weekStart: v === 'locale' ? 'locale' : (Number(v) as 0 | 1 | 6) });
          }}
        >
          {WEEK_STARTS.map((w) => (
            <option key={w.value} value={String(w.value)}>
              {w.label}
            </option>
          ))}
        </select>
      </label>
      <label class="db-field">
        <span>Week numbers</span>
        <input
          type="checkbox"
          checked={s.weekNumbers}
          onChange={(e) => app.update({ weekNumbers: e.currentTarget.checked })}
        />
      </label>
    </Dialog>
  );
}
