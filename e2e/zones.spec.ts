// Time zones (PRD §4.3, §13): the display zone, an event's own zone and dragging one in another zone. The page
// clock is Tuesday 17 November 2026, 14:00 UTC, and the system zone is UTC.
import { expect, icsWith, openApp, privateText, putPrivateFiles, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const popover = (page: Page) => page.getByRole('dialog', { name: /^Edit / });
const day = (page: Page) => page.getByRole('main', { name: 'Day view' });
const event = (page: Page, name: string) => day(page).getByRole('button', { name: new RegExp(`^${name}`) });

async function turnOnZones(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Comma');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByLabel('Show events in other time zones').check();
  await settings.getByRole('button', { name: 'Done' }).click();
}

test.describe('Time zones', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1F77D0', [
        'DTSTART:20261117T150000Z\nDTEND:20261117T160000Z\nSUMMARY:Standup',
        'DTSTART;TZID=America/New_York:20261117T110000\nDTEND;TZID=America/New_York:20261117T120000\nSUMMARY:Call',
      ]),
    });
    await page.keyboard.press('d');
  });

  test('without time zone support, an event in another zone shows its own time too', async ({ page }) => {
    await expect(page.getByRole('combobox', { name: 'Show times in' })).toHaveCount(0);
    await event(page, 'Call').dblclick();
    await expect(popover(page).getByLabel('Start time')).toHaveValue('16:00');
    await expect(popover(page)).toContainText('11:00 AM to 12:00 PM New York time');
    await expect(popover(page).getByRole('combobox', { name: 'Time zone' })).toHaveCount(0);
  });

  test('the display zone moves every event to its clock, and a reload keeps it', async ({ page }) => {
    await turnOnZones(page);
    await page.getByRole('combobox', { name: 'Show times in' }).selectOption('America/New_York');
    await expect(event(page, 'Standup')).toHaveAccessibleName(/10:00 AM to 11:00 AM/);
    await expect(event(page, 'Call')).toHaveAccessibleName(/11:00 AM to 12:00 PM/);
    await openApp(page);
    await page.keyboard.press('d');
    await expect(page.getByRole('combobox', { name: 'Show times in' })).toHaveValue('America/New_York');
    await expect(event(page, 'Standup')).toHaveAccessibleName(/10:00 AM/);
  });

  test('the zone field keeps the clock time in the new zone', async ({ page }) => {
    await turnOnZones(page);
    await event(page, 'Call').dblclick();
    const zone = popover(page).getByRole('combobox', { name: 'Time zone' });
    await expect(zone).toHaveValue('America/New_York');
    await expect(popover(page).getByLabel('Start time')).toHaveValue('11:00');
    await zone.selectOption('Europe/London');
    await popover(page).getByRole('button', { name: 'Done' }).click();
    await expect(event(page, 'Call')).toHaveAccessibleName(/11:00 AM to 12:00 PM/);
    await expect
      .poll(() => privateText(page, 'Work.ics'))
      .toContain('DTSTART;TZID=Europe/London:20261117T110000');
  });

  test('dragging an event in another zone keeps its zone', async ({ page }) => {
    const column = day(page).getByRole('group', { name: 'Tuesday, November 17' });
    const box = (await column.boundingBox())!;
    const hour = box.height / 24;
    const from = (await event(page, 'Call').boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + 10 + hour / 2, { steps: 3 });
    await page.mouse.move(from.x + from.width / 2, from.y + 10 + hour, { steps: 3 });
    await page.mouse.up();
    await expect(event(page, 'Call')).toHaveAccessibleName(/5:00 PM to 6:00 PM/);
    await expect
      .poll(() => privateText(page, 'Work.ics'))
      .toContain('DTSTART;TZID=America/New_York:20261117T120000');
  });
});
