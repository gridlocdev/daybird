// The five views and moving through time (PRD §6). The page clock is Tuesday 17 November 2026; en-US weeks start on Sunday.
import { expect, openApp, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const title = (page: Page) => page.locator('h1.db-range-title');
const view = (page: Page, name: string) => page.getByRole('main', { name: `${name} view` });

test.describe('Calendar views', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('starts in the week holding today', async ({ page }) => {
    await expect(view(page, 'Week')).toBeVisible();
    await expect(title(page)).toContainText('Nov 15 – 21');
    await expect(title(page)).toContainText('2026');
  });

  test('a single key switches the view', async ({ page }) => {
    for (const [key, name] of [
      ['d', 'Day'],
      ['m', 'Month'],
      ['y', 'Year'],
      ['a', 'Agenda'],
      ['w', 'Week'],
    ] as const) {
      await page.keyboard.press(key);
      await expect(view(page, name)).toBeVisible();
      await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
  });

  test('the view buttons switch the view, and a reload keeps it', async ({ page }) => {
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Month' }).click();
    await expect(view(page, 'Month')).toBeVisible();
    await expect(title(page)).toContainText('November');
    await openApp(page);
    await expect(view(page, 'Month')).toBeVisible();
  });

  test('a month in the Year view opens it, and a day there shows that day', async ({ page }) => {
    await page.keyboard.press('y');
    await page.getByRole('button', { name: 'March' }).click();
    await expect(view(page, 'Month')).toBeVisible();
    await expect(title(page)).toContainText('March');
    await page.keyboard.press('y');
    await page.getByRole('gridcell', { name: 'Friday, December 25, 2026' }).click();
    await expect(view(page, 'Day')).toBeVisible();
    await expect(title(page)).toContainText('December 25');
  });
});

test.describe('Moving through time', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('the arrows and keys move by the view, and Today comes back', async ({ page }) => {
    await page.keyboard.press('m');
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toContainText('December');
    await page.keyboard.press('j');
    await expect(title(page)).toContainText('January');
    await expect(title(page)).toContainText('2027');
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(title(page)).toContainText('December');
    await page.keyboard.press('t');
    await expect(title(page)).toContainText('November');
    await page.keyboard.press('w');
    await page.keyboard.press('k');
    await expect(title(page)).toContainText('Nov 8 – 14');
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(title(page)).toContainText('Nov 15 – 21');
  });

  test('a day in the mini month shows its week', async ({ page }) => {
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    await sidebar.getByRole('gridcell', { name: 'Monday, November 30, 2026' }).click();
    await expect(title(page)).toContainText('Nov 29 – Dec 5');
  });
});
