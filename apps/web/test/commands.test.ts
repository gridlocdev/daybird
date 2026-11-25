import { describe, expect, it } from 'vitest';
import { findKey, nativeMenu, shortcutGroups } from '../src/index.ts';
import { makeApp } from './helpers.ts';

describe('the app commands', () => {
  it('switch views and keep the choice', async () => {
    const { app, catalog, storage } = await makeApp();
    expect(app.view.value).toBe('week');
    catalog.run('view.month');
    expect(app.view.value).toBe('month');
    expect(storage.saved?.view).toBe('month');
    expect(app.title.value).toEqual({ main: 'November', year: '2026' });
  });

  it('move through time by the view unit and come back to today', async () => {
    const { app, catalog } = await makeApp({ weekStart: 1 });
    catalog.run('go.next');
    expect(app.range.value).toEqual({ start: '2026-11-23', end: '2026-11-30' });
    catalog.run('view.day');
    catalog.run('go.previous');
    expect(app.anchor.value).toBe('2026-11-23');
    catalog.run('go.today');
    expect(app.anchor.value).toBe('2026-11-17');
    expect(app.isShowingToday()).toBe(true);
  });

  it('let only the dialog commands through while a dialog is open', async () => {
    const { app, catalog } = await makeApp();
    catalog.run('help.commands');
    expect(app.dialog.value).toBe('commands');
    expect(catalog.run('view.month')).toBe(false);
    expect(app.view.value).toBe('week');
    catalog.run('help.shortcuts');
    expect(app.dialog.value).toBe('shortcuts');
    catalog.run('help.shortcuts');
    expect(app.dialog.value).toBeNull();
  });

  it('run nothing, not even from the menu bar, while the shortcuts window looks up a key', async () => {
    const { app, catalog } = await makeApp();
    // A plain EventTarget stands in for the window: it dispatches key events the same way.
    const target = new EventTarget() as unknown as Window;
    const press = (key: string, metaKey = false) => {
      const e = Object.assign(new Event('keydown', { cancelable: true }), {
        key,
        code: '',
        metaKey,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      });
      target.dispatchEvent(e);
      return e;
    };
    catalog.run('help.shortcuts');
    app.findKeys(catalog, target);
    expect(press('m').defaultPrevented).toBe(true);
    expect(app.foundKey.value?.text).toBe('Month');
    expect(app.view.value).toBe('week');
    expect(catalog.run('help.commands')).toBe(false);
    expect(catalog.run('help.shortcuts')).toBe(false);
    expect(press('Escape').defaultPrevented).toBe(false);
    app.close();
    expect(app.findingKey.value).toBe(false);
    expect(press('m').defaultPrevented).toBe(false);
    expect(catalog.run('view.month')).toBe(true);
  });

  it('say what a key press runs in the shortcuts window', async () => {
    const { catalog } = await makeApp();
    const press = (key: string, more: { metaKey?: boolean; shiftKey?: boolean } = {}) => ({
      key,
      code: '',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...more,
    });
    expect(findKey(catalog, press('k', { metaKey: true }), null, true)).toEqual({
      keys: ['⌘K'],
      text: 'Command Menu',
      none: false,
      pending: null,
    });
    expect(findKey(catalog, press('Shift', { shiftKey: true }), null, true)).toBeNull();
    expect(findKey(catalog, press('q', { metaKey: true, shiftKey: true }), null, true)).toMatchObject({
      keys: ['⇧⌘Q'],
      text: 'No command',
      none: true,
    });
  });

  it('toggle the sidebar and the theme', async () => {
    const { app, catalog } = await makeApp();
    catalog.run('view.sidebar');
    expect(app.settings.value.sidebarShown).toBe(false);
    catalog.run('view.themeDark');
    expect(app.settings.value.theme).toBe('dark');
    expect(catalog.get('view.themeDark')?.checked?.()).toBe(true);
  });

  it('roll today over at midnight, taking a view on today with it', async () => {
    let now = Date.UTC(2026, 10, 17, 23, 59, 30);
    const { app } = await makeApp({}, () => now);
    const today = app.today.value;
    now += 24 * 3_600_000;
    app.tick();
    expect(app.today.value).not.toBe(today);
    expect(app.anchor.value).toBe(app.today.value);
  });

  it('build the menu bar and the shortcuts window from the catalog', async () => {
    const { catalog } = await makeApp();
    const menu = nativeMenu(catalog);
    expect(menu.map((m) => ('label' in m ? m.label : ''))).toEqual(['File', 'Edit', 'View', 'Go', 'Help']);
    const groups = shortcutGroups(catalog, true);
    const views = groups.find((g) => g.title === 'Views');
    expect(views?.lines.find((l) => l.title === 'Month')?.keys).toEqual([['M'], ['⌘3']]);
  });
});
