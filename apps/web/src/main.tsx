import { effect } from '@preact/signals';
import { render } from 'preact';
import '@daybird/ui/styles.css';
import './app.css';
import './lists.css';
import {
  BrowserStore,
  FolderSession,
  MemoryStore,
  NasStore,
  NativeStore,
  after,
  every,
  listenForKeys,
  localFiredReminders,
  localSettings,
  localSnapshots,
  memorySnapshots,
  nasInfo,
  persistStorage,
  privateFolder,
  type CalendarStore,
  type SnapshotStorage,
} from '@daybird/ui';
import { App } from './app/App.tsx';
import { buildCommands } from './app/commands.ts';
import { AppController, type FolderChooser } from './app/controller.ts';
import { loadFolderSettings } from './app/calendarActions.ts';
import { loadTrashedCalendars } from './app/trashActions.ts';
import { browserNotification, startReminders, type ReminderMessage } from './app/reminders.ts';
import { nativeBridge, type DaybirdNative, type NativeFolder } from './app/native.ts';
import { menuSender, nativeMenu, watchMenuInputs } from './app/nativeMenu.ts';
import { importOpenedFiles } from './app/openedFiles.ts';
import pkg from '../package.json';

/** How often the clock checks for midnight (PRD §6.1). */
const CLOCK_MS = 30_000;
/** How often a window in front looks for changes made elsewhere (PRD §3.5). */
const REFRESH_MS = 15_000;
/** How long switching folders waits for the old one's saves (PRD §3.7). */
const SWITCH_WAIT_MS = 5_000;
/** How long a closing desktop window waits for saves; the main process gives up at 3 s. */
const CLOSE_WAIT_MS = 2_500;

const root = document.getElementById('app')!;
const native = nativeBridge();

function windowSnapshots(): SnapshotStorage {
  try {
    return localSnapshots();
  } catch {
    return memorySnapshots('window');
  }
}

/** The browser's private folder, or memory when the browser keeps no site storage (PRD §3.7). */
async function browserStore(): Promise<{ store: CalendarStore; snapshots: SnapshotStorage; kept: boolean }> {
  const folder = await privateFolder();
  if (!folder)
    return { store: new MemoryStore('This window'), snapshots: memorySnapshots('window'), kept: false };
  void persistStorage();
  return { store: new BrowserStore(folder, true), snapshots: windowSnapshots(), kept: true };
}

/** Resolves once the open folder has nothing unsaved, or after `ms`; true when it's all saved. */
function saved(app: AppController, ms: number): Promise<boolean> {
  const session = app.session.peek();
  if (!session?.hasUnsaved.peek()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      stop();
      resolve(ok);
    };
    const stop = effect(() => {
      if (!session.hasUnsaved.value) finish(true);
    });
    after(ms, () => finish(false));
  });
}

/**
 * Opens a session on `store` in place of the one open now. The old folder's saves finish first: its unsaved
 * changes would otherwise live only in this window's snapshot, which the new folder takes over.
 */
async function openStore(
  app: AppController,
  store: CalendarStore,
  snapshots: SnapshotStorage,
): Promise<boolean> {
  const old = app.session.peek();
  if (old) {
    if (!(await saved(app, SWITCH_WAIT_MS))) {
      app.say('Couldn’t open the folder: changes to this one aren’t saved yet. Try again once they are.', {
        tone: 'error',
      });
      return false;
    }
    old.close();
  }
  const session = await FolderSession.open({
    store,
    snapshots,
    appVersion: app.version,
    displayZone: () => app.displayZone,
    say: (text, options) => app.say(text, options ?? {}),
  });
  app.attach(session);
  await loadFolderSettings(app);
  await loadTrashedCalendars(app, true);
  return true;
}

/** Reads the folder again: its calendars and its settings (another window may have changed either). */
function refresh(app: AppController): void {
  void app.session.peek()?.refresh();
  void loadFolderSettings(app);
}

/** Looks for changes made elsewhere while the window is in front, and keeps a snapshot when it goes. */
function watchFolder(app: AppController): void {
  every(REFRESH_MS, () => {
    if (document.hasFocus()) refresh(app);
  });
  addEventListener('focus', () => refresh(app));
  addEventListener('pagehide', () => void app.session.peek()?.flushSnapshot());
  addEventListener('beforeunload', (e) => {
    const session = app.session.peek();
    void session?.flushSnapshot();
    if (session?.hasUnsaved.peek()) e.preventDefault();
  });
}

async function startBrowser(app: AppController): Promise<void> {
  // Served by a Daybird server with a calendar folder (PRD §15): that folder, for every browser that opens it.
  const nas = await nasInfo();
  if (nas) {
    await openStore(app, new NasStore(nas.name), windowSnapshots());
    return;
  }
  const { store, snapshots, kept } = await browserStore();
  await openStore(app, store, snapshots);
  if (!kept)
    app.say(
      'This browser doesn’t let Daybird keep anything, so calendars last only while this window is open.',
      { tone: 'error' },
    );
}

interface DesktopFolders extends FolderChooser {
  /** Opens the folder used last, or asks for one. */
  start(): Promise<void>;
}

/** The desktop app: a folder on disk the user chose, asked for on first start (PRD §3.7). */
function desktopFolders(bridge: DaybirdNative, app: () => AppController): DesktopFolders {
  const snapshots = windowSnapshots();
  const open = async (info: NativeFolder | null) => {
    if (!info) return;
    if (info.missing) {
      app().folderPrompt.value = { missing: info.path };
      return;
    }
    await openStore(app(), new NativeStore(bridge.files, info.name, info.path), snapshots);
  };
  return {
    start: async () => {
      const info = await bridge.folder.current();
      if (info) await open(info);
      else app().folderPrompt.value = { missing: null };
    },
    choose: async () => open(await bridge.folder.choose()),
    useDefault: async () => open(await bridge.folder.useDefault()),
  };
}

/** System notifications in the desktop app: a click there shows the event here. */
function nativeNotifier(bridge: DaybirdNative): (message: ReminderMessage, show: () => void) => void {
  const shows = new Map<string, () => void>();
  bridge.onNotificationClick((id) => shows.get(id)?.());
  return (message, show) => {
    shows.set(message.id, show);
    // Only recent notifications can still be clicked; forget the oldest.
    if (shows.size > 50) shows.delete(shows.keys().next().value!);
    bridge.notify({ id: message.id, title: message.title, body: message.body });
  };
}

function start(): void {
  let app: AppController | null = null;
  const folders = native ? desktopFolders(native, () => app!) : null;
  app = new AppController({
    settings: localSettings(),
    version: native?.version ?? pkg.version,
    ...(folders ? { folders } : {}),
  });
  const catalog = buildCommands(app);
  render(<App app={app} catalog={catalog} />, root);
  const shown = app;

  // Theme, accent and hour height live on <html>, so dialogs and the body follow them too (PRD §5.3).
  effect(() => {
    const { theme, accent, hourHeight } = shown.settings.value;
    const html = document.documentElement;
    if (theme === 'auto') delete html.dataset.theme;
    else html.dataset.theme = theme;
    html.dataset.accent = accent;
    html.style.setProperty('--db-hour', `${hourHeight}px`);
  });
  effect(() => {
    const t = shown.title.value;
    document.title = `${t.main ? `${t.main} ` : ''}${t.year} – Daybird`;
  });

  listenForKeys(window, catalog, () => shown.blocked());
  const opening = folders ? folders.start() : startBrowser(app);
  opening.catch((e: unknown) => {
    console.error(e);
    shown.say(`Couldn’t open the calendars: ${e instanceof Error ? e.message : String(e)}`, {
      tone: 'error',
    });
  });
  watchFolder(app);
  startReminders(app, localFiredReminders(), native ? nativeNotifier(native) : browserNotification);
  every(CLOCK_MS, () => shown.tick());
  addEventListener('focus', () => shown.tick());
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
    // Closing: give saves a moment to land, keep a snapshot of whatever didn't, then let the window go.
    native.onCloseRequested(() => {
      void saved(shown, CLOSE_WAIT_MS)
        .then(() => shown.session.peek()?.flushSnapshot())
        .catch((e: unknown) => console.error('Could not keep a recovery snapshot:', e))
        .finally(() => native.closeReady());
    });
    const menu = menuSender((items) => native.setMenu(items));
    addEventListener('focus', () => {
      menu.forget();
      menu.send(nativeMenu(catalog));
    });
    watchMenuInputs(app, () => menu.send(nativeMenu(catalog)));
    menu.send(nativeMenu(catalog));
    importOpenedFiles(app, native);
  }
}

try {
  start();
} catch (e: unknown) {
  console.error(e);
  root.textContent = `Daybird couldn't start: ${e instanceof Error ? e.message : String(e)}`;
}
