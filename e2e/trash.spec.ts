// The Trash (PRD §7.7): deleted events and calendars, restored or deleted for good. The page clock is
// Tuesday 17 November 2026, 14:00 UTC.
import { expect, icsWith, openApp, privateText, putPrivateFiles, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const trash = (page: Page) => page.getByRole('main', { name: 'Trash' });
const trashRow = (page: Page) => page.getByRole('button', { name: /^Trash/ });
const week = (page: Page) => page.getByRole('main', { name: 'Week view' });

test.describe('Trash', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1F77D0', [
        'DTSTART:20261117T150000Z\nDTEND:20261117T160000Z\nSUMMARY:Standup',
      ]),
      'Home.ics': icsWith('Home', '#2CA02C', [
        'DTSTART:20261118T150000Z\nDTEND:20261118T160000Z\nSUMMARY:Dentist',
      ]),
    });
    await page.keyboard.press('w');
  });

  test("the toolbar says Trash, and ‹ Today › say why they're off until the Trash closes", async ({
    page,
  }) => {
    await trashRow(page).click();
    await expect(trash(page)).toBeVisible();
    await expect(page.locator('h1.db-range-title')).toHaveText('Trash');
    const today = page.getByRole('button', { name: 'Today', exact: true });
    await expect(today).toBeDisabled();
    await expect(today).toHaveAttribute('title', 'Close the Trash to move through time.');
    await expect(page.getByRole('group', { name: 'View' }).locator('[aria-pressed="true"]')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('Empty Trash');
    await expect(page.getByRole('option', { name: /Empty Trash/ })).toHaveAttribute(
      'title',
      'The Trash is empty.',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('w');
    await expect(today).toBeEnabled();
    await expect(page.locator('h1.db-range-title')).toContainText('Nov 15');
  });

  test('a deleted event can be restored from the Trash', async ({ page }) => {
    await week(page)
      .getByRole('button', { name: /^Standup/ })
      .click();
    await page.keyboard.press('Delete');
    await expect(trashRow(page)).toHaveAccessibleName('Trash, 1 item');
    await trashRow(page).click();
    const row = trash(page).getByRole('listitem', { name: 'Standup' });
    await expect(row).toContainText('Event from Work, deleted Nov 17, 2026');
    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(trash(page)).toContainText('The trash is empty.');
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(week(page).getByRole('button', { name: /^Standup/ })).toBeVisible();
  });

  test('a deleted calendar is listed, and comes back with its events', async ({ page }) => {
    const home = page
      .getByRole('list', { name: 'Calendars' })
      .getByRole('listitem')
      .filter({ hasText: 'Home' });
    await home.hover();
    await home.getByRole('button', { name: 'Home options' }).click();
    await page.getByRole('menuitem', { name: 'Delete Calendar…' }).click();
    await page.getByRole('dialog', { name: 'Delete Home?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(week(page).getByRole('button', { name: /^Dentist/ })).toHaveCount(0);
    await trashRow(page).click();
    const row = trash(page).getByRole('listitem', { name: 'Home' });
    await expect(row).toContainText('Calendar, deleted');
    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('status')).toContainText('Restored Home.');
    await page.keyboard.press('w');
    await expect(week(page).getByRole('button', { name: /^Dentist/ })).toBeVisible();
  });

  test('Empty Trash asks, then deletes everything for good', async ({ page }) => {
    await week(page)
      .getByRole('button', { name: /^Standup/ })
      .click();
    await page.keyboard.press('Delete');
    await trashRow(page).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Empty Trash…' }).click();
    const ask = page.getByRole('dialog', { name: 'Empty Trash?' });
    await expect(ask).toContainText('1 event will be deleted for good.');
    await ask.getByRole('button', { name: 'Empty Trash' }).click();
    await expect(trashRow(page)).toHaveAccessibleName('Trash, empty');
    await expect.poll(() => privateText(page, '.daybird/trash.ics')).not.toContain('Standup');
  });
});
