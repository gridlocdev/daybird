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

  test('the previous, Today and next buttons stay put as the title changes width', async ({ page }) => {
    const nav = page.getByRole('group', { name: 'Move through time' });
    const where = async () => {
      const names = ['Previous', 'Today', 'Next'];
      const boxes = await Promise.all(names.map((n) => nav.getByRole('button', { name: n }).boundingBox()));
      return boxes.map((b) => Math.round(b!.x));
    };
    const stepsKeepThemPut = async (titles: readonly string[]) => {
      const before = await where();
      for (const t of titles) {
        await nav.getByRole('button', { name: 'Next' }).click();
        await expect(title(page)).toContainText(t);
        expect(await where()).toEqual(before);
      }
    };
    await page.keyboard.press('d');
    await expect(title(page)).toContainText('Tuesday, November 17');
    await stepsKeepThemPut(['Wednesday, November 18', 'Thursday, November 19', 'Friday, November 20']);
    await page.keyboard.press('m');
    await expect(title(page)).toContainText('November');
    await stepsKeepThemPut(['December']);
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

  test('an empty week or day says how to add an event, and a week with events says nothing', async ({
    page,
  }) => {
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1f6fe5', [
        'DTSTART:20261117T090000Z\nDTEND:20261117T100000Z\nSUMMARY:Standup',
      ]),
    });
    const hint = page.locator('.db-grid-hint');
    await page.keyboard.press('w');
    await expect(hint).toHaveCount(0);
    await page.keyboard.press('j');
    await expect(hint).toHaveText('No events this week. Press N, or drag in the grid, to add one.');
    await page.keyboard.press('d');
    await expect(hint).toHaveText('No events this day. Press N, or drag in the grid, to add one.');
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

test.describe('Month', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('bars wrap at week ends, timed events are lines, and a full day lists the rest', async ({ page }) => {
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1f6fe5', [
        'DTSTART;VALUE=DATE:20261116\nDTEND;VALUE=DATE:20261119\nSUMMARY:Offsite',
        'DTSTART;VALUE=DATE:20261120\nDTEND;VALUE=DATE:20261124\nSUMMARY:Long weekend',
        ...['08', '09', '10', '11', '12', '13'].map(
          (h) => `DTSTART:20261117T${h}0000Z\nDTEND:20261117T${h}3000Z\nSUMMARY:Call ${h}`,
        ),
        'DTSTART:20261125T150000Z\nDTEND:20261125T160000Z\nSUMMARY:Dentist',
        'DTSTART:20261126T100000Z\nDTEND:20261126T110000Z\nSUMMARY:Design review with a very long title indeed',
      ]),
    });
    await page.keyboard.press('m');
    const month = view(page, 'Month');
    // A long title is cut short, and its time stays whole.
    const review = month.getByRole('button', { name: /^Design review/ });
    const fits = (sel: string) => review.locator(sel).evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(await fits('.db-line-time')).toBe(true);
    expect(await fits('.db-line-title')).toBe(false);
    await expect(
      page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Month' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(month.getByRole('button', { name: /^Dentist, 3:00 PM to 4:00 PM, Work/ })).toBeVisible();
    await expect(month.getByRole('button', { name: /^Offsite, all day/ })).toHaveCount(1);
    // Friday to Monday: one bar in each week.
    await expect(month.getByRole('button', { name: /^Long weekend/ })).toHaveCount(2);

    // Offsite and six calls don't fit on the 17th: the rest are one click away.
    const more = month.getByRole('button', { name: /^\d+ more$/ });
    await expect(more).toHaveCount(1);
    const shown = await month.getByRole('button', { name: /^Call / }).count();
    await expect(more).toHaveText(`${6 - shown} more`);
    await more.click();
    const list = page.getByRole('dialog', { name: 'Tuesday, November 17' });
    await expect(list.getByRole('button', { name: /^(Offsite|Call )/ })).toHaveCount(7);
    await list.getByRole('button', { name: /^Call 13/ }).click();
    await expect(list).toBeHidden();

    // A taller window fits them all.
    await page.setViewportSize({ width: 1280, height: 1400 });
    await expect(more).toHaveCount(0);
    await expect(month.getByRole('button', { name: /^Call / })).toHaveCount(6);

    await month.getByRole('button', { name: /^Tuesday, November 17/ }).click();
    await expect(view(page, 'Day')).toBeVisible();
  });
});

test.describe('Year and Agenda', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1f6fe5', [
        'DTSTART:20261117T150000Z\nDTEND:20261117T160000Z\nSUMMARY:Standup\nLOCATION:Room 4',
        'DTSTART:20261117T090000Z\nDTEND:20261117T093000Z\nSUMMARY:Coffee',
        'DTSTART;VALUE=DATE:20261119\nDTEND;VALUE=DATE:20261121\nSUMMARY:Conference',
        'DTSTART:20261110T090000Z\nDTEND:20261110T100000Z\nSUMMARY:Last week',
        'DTSTART:20270301T090000Z\nDTEND:20270301T100000Z\nSUMMARY:Far away',
        ...['08', '09', '10', '11', '12', '13'].map(
          (h) => `DTSTART:20261203T${h}0000Z\nDTEND:20261203T${h}3000Z\nSUMMARY:Call ${h}`,
        ),
      ]),
    });
  });

  test('Year tints each day by how many events it has', async ({ page }) => {
    await page.keyboard.press('y');
    const year = view(page, 'Year');
    // A day near a month's edge shows twice; the month's own is the later one.
    const day = (name: string) => year.getByRole('gridcell', { name, exact: true }).last();
    await expect(day('Tuesday, November 17, 2026, 2 events')).toHaveClass(/db-busy-1/);
    await expect(day('Thursday, December 3, 2026, 6 events')).toHaveClass(/db-busy-3/);
    await expect(day('Wednesday, November 18, 2026')).not.toHaveClass(/db-busy/);
    await day('Thursday, December 3, 2026, 6 events').click();
    await expect(view(page, 'Day')).toBeVisible();
  });

  test('Agenda lists the days with events from today, loads more at the end, and earlier on request', async ({
    page,
  }) => {
    await page.keyboard.press('a');
    const agenda = view(page, 'Agenda');
    const headings = agenda.getByRole('heading', { level: 2 });
    await expect(headings).toHaveText([
      'Today',
      'Thursday, November 19',
      'Friday, November 20',
      'Thursday, December 3',
    ]);
    const today = agenda.getByRole('region', { name: 'Today' });
    await expect(today.getByRole('button')).toHaveText([
      /^9:00\s?AM – 9:30\s?AM.*Coffee/,
      /^3:00\s?PM – 4:00\s?PM.*Standup.*Room 4/,
    ]);
    await expect(agenda.getByRole('region', { name: 'Friday, November 20' })).toContainText('All day');

    // March is past the first 60 days; the end of the list brings it in.
    await expect(agenda.getByText('Far away')).toHaveCount(0);
    await agenda.getByRole('button', { name: 'Show 60 More Days' }).click();
    await agenda.getByRole('button', { name: 'Show 60 More Days' }).click();
    await expect(agenda.getByRole('heading', { name: 'Monday, March 1, 2027' })).toBeVisible();

    await agenda.getByRole('button', { name: 'Show Earlier' }).click();
    const past = agenda.getByRole('region', { name: 'Tuesday, November 10' }).getByRole('button');
    await expect(past).toHaveClass(/db-past/);
    await past.click();
    await expect(past).toHaveAttribute('aria-pressed', 'true');

    // Today starts the list again at today.
    await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(headings.first()).toHaveText('Today');
  });
});
