/**
 * Daybird desktop (PRD §14): one window running the web build from app://daybird/. The page reaches the
 * main process only through the preload's `daybirdNative`.
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  Notification,
  protocol,
  screen,
  shell,
} from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Channels, type NativeMenuItem, type NativeNotification } from './bridge.ts';
import { Folders } from './folders.ts';
import { icsArguments, OpenedFiles } from './openedFiles.ts';
import { editMenuTemplate, toTemplate, withStandardMenus } from './menu.ts';
import { appFile, dataPaths, isAppUrl } from './paths.ts';
import { loadSavedWindow, placeWindow, saveWindow, type SavedWindow } from './windowState.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, 'web');
/** How long a closing window waits for the page to finish saving. */
const CLOSE_WAIT_MS = 3000;
const MIN_SIZE = { width: 640, height: 440 };
/**
 * macOS: a unified title bar. The page's toolbar row is the title bar, and the centre of the traffic
 * lights lines up with its buttons (PRD §5.1).
 */
const unified = process.platform === 'darwin';
/** DAYBIRD_HEADLESS=1: render offscreen and never show a window or Dock icon (automated checks). */
const headless = process.env.DAYBIRD_HEADLESS === '1';
if (headless) app.dock?.hide();

const paths = dataPaths(process.env);
if (paths.userData) app.setPath('userData', paths.userData);
if (paths.documents) app.setPath('documents', paths.documents);
const windowFile = path.join(app.getPath('userData'), 'window-state.json');
/** DAYBIRD_FOLDER opens that folder for this run without remembering it (automated checks). */
const folders = new Folders(
  path.join(app.getPath('userData'), 'folder.json'),
  process.env.DAYBIRD_FOLDER || null,
);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win: BrowserWindow | null = null;
/** `.ics` files opened from the Finder or the command line, until the page takes them (PRD §14). */
const opened = new OpenedFiles();
opened.add(icsArguments(process.argv.slice(1), process.cwd()));
let lastWindow: SavedWindow | null = null;
let quitting = false;

/** Only our own page may use the bridge. */
function trusted(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return isAppUrl(e.senderFrame?.url);
}

function rememberWindow(w: BrowserWindow): void {
  if (headless || w.isDestroyed() || w.isMinimized()) return;
  const b = w.getNormalBounds();
  lastWindow = { ...b, maximized: w.isMaximized() };
  void saveWindow(windowFile, lastWindow).catch((e: unknown) =>
    console.warn('Could not remember the window position:', e),
  );
}

function createWindow(): BrowserWindow {
  const fallback = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const placed = placeWindow(
    headless ? null : lastWindow,
    screen.getAllDisplays().map((d) => d.workArea),
    { ...fallback, width: Math.min(1100, fallback.width), height: Math.min(760, fallback.height) },
    MIN_SIZE,
  );
  const w = new BrowserWindow({
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'Daybird',
    ...(unified ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 18, y: 20 } } : {}),
    ...(process.platform === 'darwin' ? {} : { icon: path.join(here, '..', 'build', 'icon.png') }),
    show: false,
    // The page's window grey (--db-window), so a slow first paint doesn't flash.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#232325' : '#f3f3f4',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      offscreen: headless,
      additionalArguments: [
        `--daybird-version=${app.getVersion()}`,
        `--daybird-chrome=${unified ? 'unified' : 'native'}`,
      ],
    },
  });
  if (!headless)
    w.once('ready-to-show', () => {
      if (placed.maximized) w.maximize();
      w.show();
    });
  let placeTimer: NodeJS.Timeout | null = null;
  const placeChanged = () => {
    if (placeTimer) clearTimeout(placeTimer);
    placeTimer = setTimeout(() => rememberWindow(w), 500);
  };
  for (const ev of ['move', 'resize', 'maximize', 'unmaximize'] as const) w.on(ev as 'move', placeChanged);

  // Closing asks the page to finish saving; it answers with closeReady. A page that doesn't answer in
  // time is closed anyway.
  let allowClose = false;
  let closeTimer: NodeJS.Timeout | null = null;
  const closeNow = () => {
    allowClose = true;
    if (closeTimer) clearTimeout(closeTimer);
    if (!w.isDestroyed()) w.close();
  };
  w.on('close', (e) => {
    rememberWindow(w);
    if (allowClose) return;
    // macOS keeps the app running with no window: hiding it keeps the page, so reminders still ring (PRD §14).
    if (process.platform === 'darwin' && !quitting && !headless) {
      e.preventDefault();
      w.hide();
      return;
    }
    e.preventDefault();
    if (closeTimer) return;
    w.webContents.send(Channels.closeRequested);
    closeTimer = setTimeout(closeNow, CLOSE_WAIT_MS);
  });
  w.webContents.ipc.on(Channels.closeReady, (e) => {
    if (trusted(e)) closeNow();
  });
  w.webContents.on('render-process-gone', () => {
    if (closeTimer || quitting) closeNow();
  });
  w.on('closed', () => {
    if (placeTimer) clearTimeout(placeTimer);
    if (win === w) win = null;
  });

  // In full screen the traffic lights hide, so the page drops the room it keeps for them.
  w.on('enter-full-screen', () => w.webContents.send(Channels.fullScreen, true));
  w.on('leave-full-screen', () => w.webContents.send(Channels.fullScreen, false));
  // Electron shows no menu of its own on right-click; text gets the edit menu, the page does the rest.
  w.webContents.on('context-menu', (_e, params) => {
    const template = editMenuTemplate(params, {
      replace: (word) => w.webContents.replaceMisspelling(word),
      learn: (word) => w.webContents.session.addWordToSpellCheckerDictionary(word),
    });
    if (template) Menu.buildFromTemplate(template).popup({ window: w });
  });

  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  void w.loadURL('app://daybird/index.html');
  return w;
}

/** Notifications on screen, kept so they aren't collected before they're clicked. */
const notifications = new Set<Notification>();

/** A reminder as a system notification (PRD §9); a click brings the window forward and shows the event. */
function notify(e: Electron.IpcMainEvent, n: NativeNotification): void {
  if (!trusted(e) || headless || !Notification.isSupported()) return;
  if (typeof n?.id !== 'string' || typeof n.title !== 'string' || typeof n.body !== 'string') return;
  const shown = new Notification({ title: n.title, body: n.body });
  const done = () => notifications.delete(shown);
  shown.on('click', () => {
    done();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send(Channels.notificationClick, n.id);
  });
  shown.on('close', done);
  notifications.add(shown);
  shown.show();
}

/** Brings the window forward, making one if it was closed (macOS keeps running with none). */
function showWindow(): void {
  if (!win) {
    win = createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!headless) win.show();
  win.focus();
}

/** New opened files: the page takes them once it has a calendar folder open. */
function filesOpened(files: readonly string[]): void {
  if (!opened.add(files) || !app.isReady()) return;
  showWindow();
  win?.webContents.send(Channels.filesOpened);
}

function registerIpc(): void {
  ipcMain.on(Channels.setMenu, (e, items: readonly NativeMenuItem[]) => {
    if (!trusted(e) || !Array.isArray(items)) return;
    const send = (id: string) => win?.webContents.send(Channels.command, id);
    const template = withStandardMenus(toTemplate(items, send), process.platform, !app.isPackaged);
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  });
  ipcMain.handle(Channels.file, (e, op: unknown, args: unknown) =>
    trusted(e) ? folders.call(op, args) : { ok: false, code: 'failed', message: 'Not allowed.' },
  );
  ipcMain.handle(Channels.folderCurrent, (e) => (trusted(e) ? folders.current() : null));
  // Both answer the folder now open, or null when the user cancelled.
  ipcMain.handle(Channels.folderChoose, async (e) => {
    if (!trusted(e) || !win) return null;
    const picked = await dialog.showOpenDialog(win, {
      title: 'Open Calendar Folder',
      buttonLabel: 'Open',
      properties: ['openDirectory', 'createDirectory'],
    });
    const folder = picked.canceled ? undefined : picked.filePaths[0];
    return folder ? folders.open(folder) : null;
  });
  ipcMain.on(Channels.notify, (e, n: NativeNotification) => notify(e, n));
  ipcMain.handle(Channels.takeOpenedFiles, (e) => (trusted(e) ? opened.take() : []));
  ipcMain.handle(Channels.folderUseDefault, (e) =>
    trusted(e) ? folders.open(path.join(app.getPath('documents'), 'Daybird')) : null,
  );
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // Before ready too: macOS sends the files a launch opens before the app is ready.
  app.on('open-file', (e, file) => {
    e.preventDefault();
    filesOpened([file]);
  });
  app.on('second-instance', (_e, argv, cwd) => {
    showWindow();
    filesOpened(icsArguments(argv.slice(1), cwd));
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  void app.whenReady().then(async () => {
    protocol.handle('app', (req) => {
      const file = appFile(webRoot, new URL(req.url).pathname);
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Forbidden', { status: 403 });
    });
    await folders.start();
    registerIpc();
    lastWindow = await loadSavedWindow(windowFile);
    win = createWindow();
    app.on('activate', showWindow);
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || quitting || headless) app.quit();
  });
}
