// The repeat field, its Custom dialog and rules shown in words (PRD §8.1, §8.2). The page clock is Tuesday
// 17 November 2026, 14:00 UTC, and the display zone is UTC.
import { expect, icsWith, openApp, putPrivateFiles, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const popover = (page: Page) => page.getByRole('dialog', { name: /^Edit / });
const week = (page: Page) => page.getByRole('main', { name: 'Week view' });
const event = (page: Page, name: string) => week(page).getByRole('button', { name: new RegExp(`^${name}`) });
const repeat = (page: Page) => popover(page).getByRole('combobox', { name: 'Repeat' });

test.describe('Repeating events', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1F77D0', [
        'DTSTART:20261116T090000Z\nDTEND:20261116T100000Z\nSUMMARY:Standup',
        'DTSTART:20261116T120000Z\nDTEND:20261116T130000Z\nRRULE:FREQ=DAILY;COUNT=5\nSUMMARY:Lunch',
        'DTSTART:20261102T150000Z\nDTEND:20261102T160000Z\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1\nSUMMARY:Review',
      ]),
    });
  });

  test('Every Weekday makes a single event repeat at once', async ({ page }) => {
    await event(page, 'Standup').dblclick();
    await repeat(page).selectOption('Every Weekday');
    await popover(page).getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(event(page, 'Standup')).toHaveCount(5);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(event(page, 'Standup')).toHaveCount(1);
  });

  test('the Custom dialog sets the days and an end, with the rule in words', async ({ page }) => {
    await event(page, 'Standup').dblclick();
    await repeat(page).selectOption('Custom…');
    const dialog = page.getByRole('dialog', { name: 'Custom Repeat' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Wednesday' }).click();
    await dialog.getByRole('button', { name: 'Friday' }).click();
    await dialog.getByRole('radio', { name: /After/ }).check();
    await dialog.getByRole('spinbutton', { name: 'Times' }).fill('4');
    await expect(dialog).toContainText('Every week on Monday, Wednesday and Friday, 4 times');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(repeat(page)).toHaveValue('custom');
    await popover(page).getByRole('button', { name: 'Done' }).click();
    await expect(event(page, 'Standup')).toHaveCount(3);
  });

  test('changing the repeat of a repeating event asks only Future or All', async ({ page }) => {
    await event(page, 'Lunch').nth(2).dblclick();
    await repeat(page).selectOption('Never');
    await popover(page).getByRole('button', { name: 'Done' }).click();
    const ask = page.getByRole('dialog', { name: 'Change a repeating event?' });
    await expect(ask.getByRole('button', { name: 'This Event' })).toHaveCount(0);
    await expect(ask.getByRole('button', { name: 'This and Future Events' })).toBeFocused();
    await ask.getByRole('button', { name: 'This and Future Events' }).click();
    // Monday and Tuesday stay; Wednesday is now a single event; Thursday and Friday are gone.
    await expect(event(page, 'Lunch')).toHaveCount(3);
  });

  test('a rule the dialog can’t show stays in words, and can be replaced', async ({ page }) => {
    await page.keyboard.press('m');
    await page
      .getByRole('main', { name: 'Month view' })
      .getByRole('button', { name: /^Review/ })
      .first()
      .dblclick();
    await expect(popover(page)).toBeVisible();
    await expect(repeat(page)).toHaveCount(0);
    await popover(page).getByRole('button', { name: 'Replace with a Simple Rule' }).click();
    await popover(page).getByRole('button', { name: 'Done' }).click();
    await page
      .getByRole('dialog', { name: 'Change a repeating event?' })
      .getByRole('button', { name: 'All Events' })
      .click();
    await page
      .getByRole('main', { name: 'Month view' })
      .getByRole('button', { name: /^Review/ })
      .first()
      .dblclick();
    await expect(repeat(page)).toHaveValue('monthly');
  });
});
