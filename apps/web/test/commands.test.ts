import { describe, expect, it } from 'vitest';
import { nativeMenu, shortcutGroups } from '../src/index.ts';
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
