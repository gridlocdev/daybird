// Where calendars are kept and how they save (PRD §3.4–§3.7). In a browser with no folder picked, they live in the
// browser's private folder.
import { expect, openApp, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

/** The `.ics` files in the browser's private folder. */
const privateFiles = (page: Page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('calendars', { create: true });
    const names: string[] = [];
    for await (const [name] of folder.entries()) if (name.endsWith('.ics')) names.push(name);
    return names.sort();
  });

test.describe('Saving', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('an empty browser starts with one calendar, kept in the browser', async ({ page }) => {
    await expect(page.getByText('Stored in this browser')).toBeVisible();
    await expect.poll(() => privateFiles(page)).toEqual(['Calendar.ics']);
    const text = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle('calendars');
      return (await (await folder.getFileHandle('Calendar.ics')).getFile()).text();
    });
    expect(text).toContain('X-WR-CALNAME:Calendar');
    expect(text).toContain('PRODID:-//Daybird//Daybird');
  });

  test('a reload keeps the calendar and asks nothing', async ({ page }) => {
    await expect.poll(() => privateFiles(page)).toEqual(['Calendar.ics']);
    await page.reload();
    await expect(page.getByText('Stored in this browser')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await privateFiles(page)).toEqual(['Calendar.ics']);
  });
});
