import { effect } from '@preact/signals';
import { render } from 'preact';
import '@daybird/ui/styles.css';
import './app.css';
import {
  BrowserStore,
  FolderSession,
  MemoryStore,
  every,
  listenForKeys,
  localSettings,
  localSnapshots,
  memorySnapshots,
  persistStorage,
  privateFolder,
  type CalendarStore,
  type SnapshotStorage,
} from '@daybird/ui';
import { App } from './app/App.tsx';
import { buildCommands } from './app/commands.ts';
import { AppController } from './app/controller.ts';
import { nativeBridge } from './app/native.ts';
import { menuSender, nativeMenu, watchMenuInputs } from './app/nativeMenu.ts';
import pkg from '../package.json';

/** How often the clock checks for midnight (PRD §6.1). */
const CLOCK_MS = 30_000;
/** How often a window in front looks for changes made elsewhere (PRD §3.5). */
const REFRESH_MS = 15_000;

const root = document.getElementById('app')!;
const native = nativeBridge();

/** The browser's private folder, or memory when the browser keeps no site storage (PRD §3.7). */
async function openStore(): Promise<{ store: CalendarStore; snapshots: SnapshotStorage; kept: boolean }> {
  const folder = await privateFolder();
  if (!folder)
    return { store: new MemoryStore('This window'), snapshots: memorySnapshots('window'), kept: false };
  void persistStorage();
  let snapshots: SnapshotStorage;
  try {
    snapshots = localSnapshots();
  } catch {
    snapshots = memorySnapshots('window');
  }
  return { store: new BrowserStore(folder, true), snapshots, kept: true };
}

async function openFolder(app: AppController, version: string): Promise<void> {
  const { store, snapshots, kept } = await openStore();
  const session = await FolderSession.open({
    store,
    snapshots,
    appVersion: version,
    say: (text, options) => app.say(text, options ?? {}),
  });
  app.attach(session);
  if (!kept)
    app.say(
      'This browser doesn’t let Daybird keep anything, so calendars last only while this window is open.',
      {
        tone: 'error',
      },
    );
  every(REFRESH_MS, () => {
    if (document.hasFocus()) void session.refresh();
  });
  addEventListener('focus', () => void session.refresh());
  addEventListener('pagehide', () => void session.flushSnapshot());
  addEventListener('beforeunload', (e) => {
    void session.flushSnapshot();
    if (session.hasUnsaved.peek()) e.preventDefault();
  });
}

function start(): void {
  const app = new AppController({ settings: localSettings(), version: native?.version ?? pkg.version });
  const catalog = buildCommands(app);
  render(<App app={app} catalog={catalog} />, root);

  // Theme, accent and hour height live on <html>, so dialogs and the body follow them too (PRD §5.3).
  effect(() => {
    const { theme, accent, hourHeight } = app.settings.value;
    const html = document.documentElement;
    if (theme === 'auto') delete html.dataset.theme;
    else html.dataset.theme = theme;
    html.dataset.accent = accent;
    html.style.setProperty('--db-hour', `${hourHeight}px`);
  });
  effect(() => {
    const t = app.title.value;
    document.title = `${t.main ? `${t.main} ` : ''}${t.year} – Daybird`;
  });

  listenForKeys(window, catalog, () => app.blocked());
  openFolder(app, app.version).catch((e: unknown) => {
    console.error(e);
    app.say(`Couldn’t open the calendars: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
  });
  every(CLOCK_MS, () => app.tick());
  addEventListener('focus', () => app.tick());
  if (import.meta.env.DEV) Object.assign(globalThis, { daybird: { app, catalog } });

  if (native) {
    const html = document.documentElement.classList;
    html.toggle('db-unified', native.chrome === 'unified');
    native.onFullScreen((full) => html.toggle('db-fullscreen', full));
    native.onCommand((id) => {
      // Menu accelerators reach the app before the page; in a text field the field keeps its own keys.
      // Undo and Redo there undo typing, as they would without the menu.
      const inText = !!document.activeElement?.closest('input, textarea, select');
      if (inText && (id === 'edit.undo' || id === 'edit.redo')) {
        document.execCommand(id === 'edit.undo' ? 'undo' : 'redo');
        return;
      }
      if (inText && !catalog.get(id)?.global) return;
      catalog.run(id);
    });
    native.onCloseRequested(() => native.closeReady());
    const menu = menuSender((items) => native.setMenu(items));
    addEventListener('focus', () => {
      menu.forget();
      menu.send(nativeMenu(catalog));
    });
    watchMenuInputs(app, () => menu.send(nativeMenu(catalog)));
    menu.send(nativeMenu(catalog));
  }
}

try {
  start();
} catch (e: unknown) {
  console.error(e);
  root.textContent = `Daybird couldn't start: ${e instanceof Error ? e.message : String(e)}`;
}
