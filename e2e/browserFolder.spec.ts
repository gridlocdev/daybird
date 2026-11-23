// Opening a folder on the computer in the browser (PRD §3.7). Firefox and Safari have no showDirectoryPicker, so
// these scenarios take it away and pick the folder through <input webkitdirectory>, which Chromium also has: the
// folder opens read-only, and every command that would write is off and says why.
import { fileURLToPath } from 'node:url';
import { commandMenu, expect, openApp, runCommand, test, watchErrors } from './fixtures.ts';
import type { Page } from '@playwright/test';

const FIXTURE = fileURLToPath(new URL('fixtures/basic', import.meta.url));
const REASON = /basic is open read-only: this browser can’t save to a folder opened this way/;

/** The `.ics` files in the browser's private folder, which a read-only folder must leave alone. */
const privateFiles = (page: Page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('calendars', { create: true });
    const names: string[] = [];
    for await (const [name] of folder.entries()) if (name.endsWith('.ics')) names.push(name);
    return names.sort();
  });

/** Opens the fixture folder the way Firefox and Safari do. */
async function openReadOnly(page: Page): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await runCommand(page, 'Open Calendar Folder');
  await (await chooser).setFiles(FIXTURE);
  await expect(page.locator('.db-status')).toContainText('basic (read-only)');
}

test.describe('Opening a folder in the browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showDirectoryPicker', { value: undefined });
    });
    await openApp(page);
    await expect.poll(() => privateFiles(page)).toEqual(['Calendar.ics']);
  });

  test('a folder picked without showDirectoryPicker opens read-only with its calendars', async ({ page }) => {
    const errors = watchErrors(page);
    await openReadOnly(page);
    await expect(page.locator('.db-status')).toContainText('Opened basic read-only.');
    const calendars = page.getByRole('list', { name: 'Calendars' });
    await expect(calendars).toContainText('Home');
    await expect(calendars).toContainText('Work');
    await expect(page.getByText('Planning meeting')).toBeVisible();
    await expect(page.getByText('Stored in this browser')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('commands that write are off and say why; looking around still works', async ({ page }) => {
    await openReadOnly(page);
    // Double-clicking empty grid would add an event; here it says why it can't.
    await page.getByRole('main', { name: 'Week view' }).dblclick({ position: { x: 300, y: 600 } });
    await expect(page.locator('.db-status')).toContainText(REASON);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+KeyK');
    const menu = commandMenu(page);
    await expect(menu.getByRole('combobox')).toBeFocused();
    await page.keyboard.type('New Event');
    const option = menu.getByRole('option', { name: /^New Event/ }).first();
    await expect(option).toHaveAttribute('aria-disabled', 'true');
    await expect(option).toHaveAttribute('title', REASON);
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(page.locator('.db-status')).toContainText(REASON);

    await expect(page.getByRole('button', { name: 'New Calendar' })).toBeDisabled();
    // N would add an event; in a read-only folder nothing happens to the calendars.
    await page.keyboard.press('KeyN');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // An event still opens, to read, with its fields off.
    await page.getByText('Planning meeting').dblclick();
    const popover = page.locator('.db-event-popover');
    await expect(popover).toContainText(REASON);
    await expect(popover.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Views, search and export don't write, so they stay.
    await runCommand(page, 'Month');
    await expect(page.locator('h1.db-range-title')).toContainText('November');
    expect(await privateFiles(page)).toEqual(['Calendar.ics']);
  });

  test('a reload goes back to the calendars kept in the browser', async ({ page }) => {
    await openReadOnly(page);
    await page.reload();
    await expect(page.getByText('Stored in this browser')).toBeVisible();
    await expect(page.getByText('Planning meeting')).toHaveCount(0);
  });
});
