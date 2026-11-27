// Creating, editing and deleting events (PRD §7.1, §7.2, §7.7, §8.2). The page clock is Tuesday 17 November 2026,
// 14:00 UTC, and the display zone is UTC.
import { expect, icsWith, openApp, privateText, putPrivateFiles, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const popover = (page: Page) => page.getByRole('dialog', { name: /^Edit / });
const day = (page: Page) => page.getByRole('main', { name: 'Day view' });
const event = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });

/** Drags down today's column in the Day view from one hour to another. */
async function dragDay(page: Page, fromHour: number, toHour: number): Promise<void> {
  const column = day(page).getByRole('group', { name: 'Tuesday, November 17' });
  await column.scrollIntoViewIfNeeded();
  const box = (await column.boundingBox())!;
  const hour = box.height / 24;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + fromHour * hour + 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y + (fromHour + toHour) * 0.5 * hour, { steps: 4 });
  await page.mouse.move(x, box.y + toHour * hour - 2, { steps: 4 });
  await page.mouse.up();
}

test.describe('Creating and editing events', () => {
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

  test('dragging down the day makes an event and opens the popover on it', async ({ page }) => {
    await page.keyboard.press('d');
    await dragDay(page, 16, 18);
    await expect(popover(page)).toBeVisible();
    const title = popover(page).getByRole('textbox', { name: 'Title' });
    await expect(title).toBeFocused();
    await expect(popover(page).getByLabel('Start time')).toHaveValue('16:00');
    await expect(popover(page).getByLabel('End time')).toHaveValue('18:00');
    await page.keyboard.type('Dentist');
    await page.keyboard.press('Enter');
    await expect(popover(page)).toHaveCount(0);
    await expect(event(page, 'Dentist')).toBeVisible();
    await expect.poll(() => privateText(page, 'Calendar.ics')).toContain('SUMMARY:Dentist');
    await openApp(page);
    await page.keyboard.press('d');
    await expect(event(page, 'Dentist')).toBeVisible();
  });

  test("the popover's Delete is quiet text at the far left, and Done is the filled button", async ({
    page,
  }) => {
    await event(page, 'Standup').dblclick();
    const del = popover(page).getByRole('button', { name: 'Delete' });
    const done = popover(page).getByRole('button', { name: 'Done' });
    const look = (b: typeof del) =>
      b.evaluate((el) => ({ fill: getComputedStyle(el).backgroundColor, x: el.getBoundingClientRect().x }));
    const [d, n] = [await look(del), await look(done)];
    expect(d.fill).toBe('rgba(0, 0, 0, 0)');
    expect(n.fill).not.toBe('rgba(0, 0, 0, 0)');
    const box = (await popover(page).boundingBox())!;
    expect(d.x - box.x).toBeLessThan(40);
  });

  test('Escape on a new event nobody changed takes it away, with nothing to undo', async ({ page }) => {
    await page.keyboard.press('d');
    await dragDay(page, 16, 17);
    await expect(popover(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
    await expect(event(page, 'New Event')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(event(page, 'New Event')).toHaveCount(0);
    await expect(event(page, 'Standup')).toBeVisible();
  });

  test('N makes an event at the next half hour today', async ({ page }) => {
    await page.keyboard.press('n');
    await expect(popover(page)).toBeVisible();
    await expect(popover(page).getByLabel('Start time')).toHaveValue('14:30');
    await expect(popover(page).getByLabel('Start date')).toHaveValue('2026-11-17');
    await page.keyboard.type('Call');
    await popover(page).getByRole('button', { name: 'Done' }).click();
    await expect(event(page, 'Call')).toBeVisible();
  });

  test('everything changed in one visit to the popover undoes as one step', async ({ page }) => {
    await event(page, 'Standup').dblclick();
    await expect(popover(page)).toBeVisible();
    await popover(page).getByRole('textbox', { name: 'Title' }).fill('Planning');
    await popover(page).getByRole('textbox', { name: 'Location' }).fill('Room 4');
    await popover(page).getByRole('button', { name: 'Done' }).click();
    await expect(event(page, 'Planning')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(event(page, 'Standup')).toBeVisible();
    await expect(event(page, 'Planning')).toHaveCount(0);
  });

  test('Delete sends an event to the Trash, and the notice undoes it', async ({ page }) => {
    await event(page, 'Standup').click();
    await page.keyboard.press('Delete');
    await expect(event(page, 'Standup')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Deleted Standup.');
    await page.locator('.db-notice').getByRole('button', { name: 'Undo' }).click();
    await expect(event(page, 'Standup')).toBeVisible();
  });

  test('a change to a repeating event asks which occurrences it is for', async ({ page }) => {
    await page
      .getByRole('main', { name: 'Week view' })
      .getByRole('button', { name: /^Lunch/ })
      .nth(1)
      .dblclick();
    await popover(page).getByRole('textbox', { name: 'Title' }).fill('Team Lunch');
    await popover(page).getByRole('button', { name: 'Done' }).click();
    const ask = page.getByRole('dialog', { name: 'Change a repeating event?' });
    await expect(ask).toBeVisible();
    await expect(ask.getByRole('button', { name: 'This Event' })).toBeFocused();
    await ask.getByRole('button', { name: 'This Event' }).click();
    await expect(event(page, 'Team Lunch')).toHaveCount(1);
    await expect(event(page, 'Lunch')).toHaveCount(4);
  });

  test('dragging across Month cells makes an all-day event', async ({ page }) => {
    await page.keyboard.press('m');
    const cell = (name: string) => page.getByRole('button', { name: new RegExp(`^${name},`) });
    const from = (await cell('Monday, November 23').boundingBox())!;
    const to = (await cell('Wednesday, November 25').boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + 40);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 6 });
    await page.mouse.up();
    await expect(popover(page)).toBeVisible();
    await expect(popover(page).getByRole('checkbox', { name: 'All-day' })).toBeChecked();
    await expect(popover(page).getByLabel('Start date')).toHaveValue('2026-11-23');
    await expect(popover(page).getByLabel('End date')).toHaveValue('2026-11-25');
  });
});
