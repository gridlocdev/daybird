// The five views and moving through time (PRD §6). The page clock is Tuesday 17 November 2026; en-US weeks start on Sunday.
import { expect, icsWith, openApp, putPrivateFiles, test } from './fixtures.ts';
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

test.describe('Week and Day', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('Week shows timed events side by side, all-day bars on top and the now line in today', async ({
    page,
  }) => {
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1f6fe5', [
        'DTSTART:20261117T090000Z\nDTEND:20261117T110000Z\nSUMMARY:Planning\nLOCATION:Room 4',
        'DTSTART:20261117T093000Z\nDTEND:20261117T100000Z\nSUMMARY:Standup\nRRULE:FREQ=DAILY;COUNT=5',
        'DTSTART;VALUE=DATE:20261116\nDTEND;VALUE=DATE:20261119\nSUMMARY:Offsite',
        'DTSTART:20261118T220000Z\nDTEND:20261119T020000Z\nSUMMARY:Late launch',
      ]),
    });
    const week = view(page, 'Week');
    const planning = week.getByRole('button', { name: /^Planning, 9:00 AM to 11:00 AM, Room 4, Work/ });
    const standup = week
      .getByRole('group', { name: 'Tuesday, November 17' })
      .getByRole('button', { name: /^Standup/ });
    await expect(planning).toBeVisible();
    await expect(standup).toBeVisible();
    await expect(week.getByRole('button', { name: /^Standup/ })).toHaveCount(5);
    // Side by side: Planning on the left half, Standup on the right.
    const [a, b] = [await planning.boundingBox(), await standup.boundingBox()];
    expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + 1);
    expect(Math.abs(a!.width - b!.width)).toBeLessThan(2);
    await expect(
      week.getByRole('group', { name: 'All-day events' }).getByRole('button', { name: /^Offsite/ }),
    ).toBeVisible();
    // Across midnight: in both days.
    await expect(week.getByRole('button', { name: /^Late launch/ })).toHaveCount(2);
    await expect(week.getByRole('group', { name: 'Tuesday, November 17' }).locator('.db-now')).toHaveCount(1);
    await expect(week.locator('.db-now')).toHaveCount(1);

    await planning.click();
    await expect(planning).toHaveAttribute('aria-pressed', 'true');
  });

  test('taller and shorter hours change the grid and are remembered', async ({ page }) => {
    const hour = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--db-hour').trim());
    await expect.poll(hour).toBe('48px');
    await page.keyboard.press('ControlOrMeta+=');
    await expect.poll(hour).toBe('56px');
    await page.keyboard.press('ControlOrMeta+-');
    await page.keyboard.press('ControlOrMeta+-');
    await expect.poll(hour).toBe('40px');
    await page.reload();
    await expect.poll(hour).toBe('40px');
  });
});
