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

  test('Settings changes the time format and the hour a day opens at', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+Comma');
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByLabel('Time format').selectOption({ label: '24-hour' });
    await settings.getByLabel('Day starts at').selectOption('6');
    await page.keyboard.press('Escape');
    await expect(page.locator('.db-hour-label', { hasText: /^13:00$/ })).toHaveCount(1);
    // A week without today opens at the first visible hour (§6.1).
    await page.keyboard.press('j');
    const body = page.locator('.db-column-body');
    const top = await body.evaluate((el) => el.scrollTop);
    // 48 px an hour: the grid opens just above 6:00, not at the 8:00 default.
    expect(top).toBeGreaterThan(5 * 48);
    expect(top).toBeLessThanOrEqual(6 * 48);
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
