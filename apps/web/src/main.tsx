import { effect } from '@preact/signals';
import { render } from 'preact';
import '@daybird/ui/styles.css';
import './app.css';
import { every, listenForKeys, localSettings } from '@daybird/ui';
import { App } from './app/App.tsx';
import { buildCommands } from './app/commands.ts';
import { AppController } from './app/controller.ts';
import { nativeBridge } from './app/native.ts';
import { menuSender, nativeMenu, watchMenuInputs } from './app/nativeMenu.ts';
import pkg from '../package.json';

/** How often the clock checks for midnight (PRD §6.1). */
const CLOCK_MS = 30_000;

const root = document.getElementById('app')!;
const native = nativeBridge();

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
  every(CLOCK_MS, () => app.tick());
  addEventListener('focus', () => app.tick());
  if (import.meta.env.DEV) Object.assign(globalThis, { daybird: { app, catalog } });

  if (native) {
    const html = document.documentElement.classList;
    html.toggle('db-unified', native.chrome === 'unified');
    native.onFullScreen((full) => html.toggle('db-fullscreen', full));
    native.onCommand((id) => {
      // Menu accelerators reach the app before the page; in a text field the field keeps its own keys.
      const inText = !!document.activeElement?.closest('input, textarea, select');
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
