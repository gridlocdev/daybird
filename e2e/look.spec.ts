// Appearance: light, dark, accent colours and the week settings (PRD §5.1, §13).
import { expect, openApp, test } from './fixtures.ts';

test.describe('Appearance', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('looks right in light and dark', async ({ page }) => {
    await expect(page).toHaveScreenshot('week-light.png');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page).toHaveScreenshot('week-dark.png');
    await page.keyboard.press('m');
    await expect(page).toHaveScreenshot('month-dark.png');
  });

  test('Settings changes the theme, the accent and the first day of the week, and a reload keeps them', async ({
    page,
  }) => {
    await page.keyboard.press('ControlOrMeta+Comma');
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('radio', { name: 'Dark' }).click();
    await settings.getByRole('radio', { name: 'Green' }).click();
    await settings.getByLabel('Week starts on').selectOption({ label: 'Monday' });
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'green');
    await expect(page.locator('h1.db-range-title')).toContainText('Nov 16 – 22');
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('h1.db-range-title')).toContainText('Nov 16 – 22');
  });

  test('week numbers show in the month view when turned on', async ({ page }) => {
    await page.keyboard.press('m');
    await page.keyboard.press('ControlOrMeta+Comma');
    await page.getByRole('dialog', { name: 'Settings' }).getByLabel('Week numbers').check();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('main', { name: 'Month view' })).toContainText('47');
  });
});
