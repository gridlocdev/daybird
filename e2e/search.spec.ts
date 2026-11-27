// Search (PRD §10). The page clock is Tuesday 17 November 2026, 14:00 UTC.
import { expect, icsWith, openApp, putPrivateFiles, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const field = (page: Page) => page.getByRole('searchbox', { name: 'Search' });
const results = (page: Page) => page.getByRole('main', { name: 'Search results' });

test.describe('Search', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1F77D0', [
        'DTSTART:20261117T150000Z\nDTEND:20261117T160000Z\nSUMMARY:Standup',
        'DTSTART:20261203T120000Z\nDTEND:20261203T130000Z\nSUMMARY:Lunch\nLOCATION:Café Nord',
        'DTSTART:20261001T120000Z\nDTEND:20261001T130000Z\nSUMMARY:Planning\nDESCRIPTION:Bring lunch',
      ]),
    });
    await page.keyboard.press('w');
  });

  test('typing lists matches by title, place and notes, nearest first', async ({ page }) => {
    await page.keyboard.press('/');
    await expect(field(page)).toBeFocused();
    await page.keyboard.type('LUNCH');
    const rows = results(page).getByRole('button');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAccessibleName(/^Lunch/);
    await expect(rows.nth(1)).toHaveAccessibleName(/^Planning/);
    await field(page).fill('cafe');
    await expect(rows).toHaveCount(1);
    await expect(page.locator('h1.db-range-title')).toHaveText('Search');
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveAttribute(
      'title',
      'Clear the search to move through time.',
    );
  });

  test('Enter shows the first result in its day; Escape brings the view back', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+f');
    await page.keyboard.type('lunch');
    await page.keyboard.press('Enter');
    const day = page.getByRole('main', { name: 'Day view' });
    await expect(day.getByRole('button', { name: /^Lunch/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('December 3');

    await page.keyboard.press('/');
    await page.keyboard.type('nothing like this');
    await expect(results(page)).toContainText('No events match “nothing like this”.');
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveValue('');
    await expect(day).toBeVisible();
  });
});
