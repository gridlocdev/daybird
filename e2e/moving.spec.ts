// Moving, resizing, copying and the right-click menus (PRD §7.3, §7.5, §12). The page clock is Tuesday
// 17 November 2026, 14:00 UTC, and the display zone is UTC.
import { expect, icsWith, openApp, putPrivateFiles, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const event = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name},`) });
const column = (page: Page, day: string) => page.getByRole('group', { name: day });

/** Drags from a point in one element to a point in another, in steps, as a hand would. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, alt = false) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

/** A point `hour` hours down a day's column, in its middle. */
async function at(page: Page, day: string, hour: number) {
  const box = (await column(page, day).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + (hour * box.height) / 24 };
}

test.describe('Moving and copying events', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1F77D0', [
        'DTSTART:20261117T090000Z\nDTEND:20261117T100000Z\nSUMMARY:Standup',
        'DTSTART:20261116T120000Z\nDTEND:20261116T130000Z\nRRULE:FREQ=DAILY;COUNT=5\nSUMMARY:Lunch',
      ]),
    });
  });

  test('dragging an event moves it to another time and day, and undo puts it back', async ({ page }) => {
    const standup = event(page, 'Standup');
    await standup.scrollIntoViewIfNeeded();
    const box = (await standup.boundingBox())!;
    const to = await at(page, 'Thursday, November 19', 11);
    await drag(page, { x: box.x + box.width / 2, y: box.y + 4 }, { x: to.x, y: to.y + 4 });
    await expect(standup).toHaveAccessibleName(/^Standup, 11:00 AM to 12:00 PM/);
    await expect(
      column(page, 'Thursday, November 19').getByRole('button', { name: /^Standup/ }),
    ).toBeVisible();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(
      column(page, 'Tuesday, November 17').getByRole('button', { name: /^Standup, 9:00 AM/ }),
    ).toBeVisible();
  });

  test('a drag still drops when the dragged event is drawn again mid-drag', async ({ page }) => {
    const standup = event(page, 'Standup');
    await standup.scrollIntoViewIfNeeded();
    const box = (await standup.boundingBox())!;
    const to = await at(page, 'Thursday, November 19', 11);
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    await page.mouse.move((box.x + to.x) / 2, (box.y + to.y) / 2, { steps: 4 });
    await expect(page.locator('.db-drag-ghost')).toBeVisible();
    // A re-draw (a new event saved, its popover closed) swaps the element and takes its pointer capture with it.
    await standup.evaluate((el) => el.remove());
    await page.mouse.move(to.x, to.y + 4, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.db-drag-ghost')).toHaveCount(0);
    await expect(
      column(page, 'Thursday, November 19').getByRole('button', { name: /^Standup, 11:00 AM/ }),
    ).toBeVisible();
  });

  test('dragging the bottom edge changes the end, and Option-drag copies', async ({ page }) => {
    const standup = event(page, 'Standup');
    await standup.scrollIntoViewIfNeeded();
    let box = (await standup.boundingBox())!;
    const to = await at(page, 'Tuesday, November 17', 11.5);
    await drag(page, { x: box.x + box.width / 2, y: box.y + box.height - 2 }, to);
    await expect(standup).toHaveAccessibleName(/^Standup, 9:00 AM to 11:30 AM/);
    box = (await standup.boundingBox())!;
    const there = await at(page, 'Wednesday, November 18', 9);
    await drag(page, { x: box.x + box.width / 2, y: box.y + 4 }, { x: there.x, y: there.y + 4 }, true);
    await expect(event(page, 'Standup')).toHaveCount(2);
  });

  test('the arrow keys move the selected event; with nothing selected they move through time', async ({
    page,
  }) => {
    await event(page, 'Standup').click();
    await page.keyboard.press('ArrowDown');
    await expect(event(page, 'Standup')).toHaveAccessibleName(/^Standup, 9:15 AM/);
    await page.keyboard.press('Shift+ArrowDown');
    await expect(event(page, 'Standup')).toHaveAccessibleName(/^Standup, 10:15 AM/);
    await page.keyboard.press('ArrowRight');
    await expect(
      column(page, 'Wednesday, November 18').getByRole('button', { name: /^Standup/ }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('h1.db-range-title')).toContainText('Nov 22 – 28');
  });

  test('copy and paste, and duplicate, add copies of an event', async ({ page }) => {
    await event(page, 'Standup').click();
    await page.keyboard.press('ControlOrMeta+d');
    await expect(event(page, 'Standup')).toHaveCount(2);
    await page.keyboard.press('ControlOrMeta+c');
    await expect(page.locator('.db-notice')).toContainText('Copied Standup');
    await page.keyboard.press('Escape');
    await page.keyboard.press('j');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(event(page, 'Standup')).toHaveCount(1);
    await expect(event(page, 'Standup')).toHaveAccessibleName(/^Standup, 9:00 AM/);
  });

  test('the right-click menus act on the event, or on the place clicked', async ({ page }) => {
    await event(page, 'Standup').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Event menu' });
    await expect(menu.getByRole('menuitem', { name: 'Open Event' })).toBeFocused();
    await menu.getByRole('menuitem', { name: 'Delete Event' }).click();
    await expect(event(page, 'Standup')).toHaveCount(0);
    const spot = await at(page, 'Friday, November 20', 15);
    await page.mouse.click(spot.x, spot.y + 2, { button: 'right' });
    await page
      .getByRole('menu', { name: 'Calendar grid menu' })
      .getByRole('menuitem', { name: 'New Event Here' })
      .click();
    const popover = page.getByRole('dialog', { name: /^Edit / });
    await expect(popover.getByLabel('Start time')).toHaveValue('15:00');
    await expect(popover.getByLabel('Start date')).toHaveValue('2026-11-20');
  });

  test('moving one occurrence of a repeating event asks which ones', async ({ page }) => {
    const lunch = column(page, 'Wednesday, November 18').getByRole('button', { name: /^Lunch/ });
    await lunch.click();
    await page.keyboard.press('ArrowDown');
    const ask = page.getByRole('dialog', { name: 'Change a repeating event?' });
    await ask.getByRole('button', { name: 'This Event' }).click();
    await expect(
      column(page, 'Wednesday, November 18').getByRole('button', { name: /^Lunch, 12:15 PM/ }),
    ).toBeVisible();
    await expect(
      column(page, 'Thursday, November 19').getByRole('button', { name: /^Lunch, 12:00 PM/ }),
    ).toBeVisible();
  });

  test('dragging in Month moves an event by days and keeps its time', async ({ page }) => {
    await page.keyboard.press('m');
    const standup = event(page, 'Standup');
    const from = (await standup.boundingBox())!;
    const target = (await page.getByRole('button', { name: /^Friday, November 27,/ }).boundingBox())!;
    await drag(page, { x: from.x + 10, y: from.y + from.height / 2 }, { x: target.x - 20, y: target.y + 30 });
    await page.keyboard.press('w');
    await page.keyboard.press('j');
    await expect(
      column(page, 'Friday, November 27').getByRole('button', { name: /^Standup, 9:00 AM/ }),
    ).toBeVisible();
  });
});
