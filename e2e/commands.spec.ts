// The command menu, the Keyboard Shortcuts window and Settings (PRD §12, §13).
import { commandMenu, expect, openApp, runCommand, test, watchErrors } from './fixtures.ts';

test.describe('Command menu and shortcuts', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('starts with no errors in the console', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await page.clock.runFor(60_000);
    expect(errors).toEqual([]);
  });

  test('the command menu runs a command', async ({ page }) => {
    await runCommand(page, 'Month');
    await expect(page.getByRole('main', { name: 'Month view' })).toBeVisible();
  });

  test('the command menu closes with Escape and gives the keyboard back', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(commandMenu(page).getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(commandMenu(page)).toBeHidden();
    await page.keyboard.press('d');
    await expect(page.getByRole('main', { name: 'Day view' })).toBeVisible();
  });

  test('a single-letter key does nothing while a dialog is open', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+Slash');
    await page.keyboard.press('m');
    await expect(page.getByRole('main', { name: 'Week view' })).toBeVisible();
  });

  test('the Keyboard Shortcuts window lists the shortcuts', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+Slash');
    const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    await expect(dialog).toContainText('Moving through time');
    await expect(dialog).toContainText('Agenda');
    await page.keyboard.press('ControlOrMeta+Slash');
    await expect(dialog).toBeHidden();
  });

  test('Press a Shortcut says what a key runs, runs nothing, and Escape gives the keys back', async ({
    page,
  }) => {
    await page.keyboard.press('ControlOrMeta+Slash');
    const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    await dialog.getByRole('button', { name: 'Press a Shortcut…' }).click();
    const finder = dialog.getByRole('status');
    await expect(finder).toContainText('Press any keys');
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(finder).toContainText('Command Menu');
    await expect(commandMenu(page)).toBeHidden();
    await page.keyboard.press('m');
    await expect(finder).toContainText('Month');
    await page.keyboard.press('ControlOrMeta+Shift+KeyQ');
    await expect(finder).toContainText('No command');
    await expect(page.getByRole('main', { name: 'Week view' })).toBeVisible();
    // The first Escape leaves the finder, the second closes the window.
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('button', { name: 'Press a Shortcut…' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.keyboard.press('d');
    await expect(page.getByRole('main', { name: 'Day view' })).toBeVisible();
  });

  test('Press a Shortcut stops with its button, and closing the window gives the keys back', async ({
    page,
  }) => {
    await page.keyboard.press('ControlOrMeta+Slash');
    const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    await dialog.getByRole('button', { name: 'Press a Shortcut…' }).click();
    await dialog.getByRole('button', { name: 'Stop' }).click();
    await page.keyboard.press('ControlOrMeta+Slash');
    await expect(dialog).toBeHidden();
    await page.keyboard.press('ControlOrMeta+Slash');
    await dialog.getByRole('button', { name: 'Press a Shortcut…' }).click();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await page.keyboard.press('m');
    await expect(page.getByRole('main', { name: 'Month view' })).toBeVisible();
  });
});
