// Import and export (PRD §11). The page clock is Tuesday 17 November 2026, 14:00 UTC.
import { readFile } from 'node:fs/promises';
import { expect, icsWith, openApp, putPrivateFiles, runCommand, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const week = (page: Page) => page.getByRole('main', { name: 'Week view' });

/** A file to import: Standup is already in Work (same UID), Review is new. */
const holidays = icsWith('Elsewhere', '#000000', [
  'DTSTART:20261117T150000Z\nDTEND:20261117T160000Z\nSUMMARY:Standup',
  'DTSTART:20261118T090000Z\nDTEND:20261118T100000Z\nSUMMARY:Review',
]).replace('UID:e2e-1@example.com', 'UID:import-review@example.com');

async function importText(page: Page, name: string, text: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+Shift+KeyI');
  await (await chooser).setFiles({ name, mimeType: 'text/calendar', buffer: Buffer.from(text) });
}

test.describe('Import and export', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1F77D0', [
        'DTSTART:20261117T150000Z\nDTEND:20261117T160000Z\nSUMMARY:Standup',
      ]),
    });
    await page.keyboard.press('w');
  });

  test('Import adds new events to the chosen calendar and skips those already there', async ({ page }) => {
    await importText(page, 'holidays.ics', holidays);
    const dialog = page.getByRole('dialog', { name: 'Import holidays.ics' });
    await expect(dialog).toContainText('2 events to add.');
    await dialog.getByRole('combobox', { name: 'Add to' }).selectOption({ label: 'Work' });
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('status')).toContainText('Imported 1 event (1 already there).');
    await expect(week(page).getByRole('button', { name: /^Review/ })).toBeVisible();
    await expect(week(page).getByRole('button', { name: /^Standup/ })).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(week(page).getByRole('button', { name: /^Review/ })).toHaveCount(0);
  });

  test('Import into a new calendar named after the file', async ({ page }) => {
    await importText(page, 'holidays.ics', holidays);
    const dialog = page.getByRole('dialog', { name: 'Import holidays.ics' });
    await dialog.getByRole('combobox', { name: 'Add to' }).selectOption({ label: 'New Calendar “holidays”' });
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('status')).toContainText('Imported 2 events.');
    await expect(page.getByRole('list', { name: 'Calendars' })).toContainText('holidays');
  });

  test('a file that isn’t a calendar says why', async ({ page }) => {
    await importText(page, 'notes.ics', 'hello');
    await expect(page.getByRole('status')).toContainText('Couldn’t import notes.ics');
  });

  test('Export Calendar and Export All save files', async ({ page }) => {
    let download = page.waitForEvent('download');
    const work = page
      .getByRole('list', { name: 'Calendars' })
      .getByRole('listitem')
      .filter({ hasText: 'Work' });
    await work.hover();
    await work.getByRole('button', { name: 'Work options' }).click();
    await page.getByRole('menuitem', { name: 'Export Calendar…' }).click();
    let file = await download;
    expect(file.suggestedFilename()).toBe('Work.ics');
    expect(await readFile(await file.path(), 'utf8')).toContain('SUMMARY:Standup');

    download = page.waitForEvent('download');
    await runCommand(page, 'Export All');
    file = await download;
    expect(file.suggestedFilename()).toBe('Daybird Calendars 2026-11-17.zip');
    const bytes = await readFile(await file.path());
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.toString('latin1')).toContain('SUMMARY:Standup');
  });
});
