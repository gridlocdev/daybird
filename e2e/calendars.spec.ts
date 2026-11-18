// The sidebar's calendars (PRD §5.2): show and hide, add, rename, colour, default and delete. Made-up calendars.
import { expect, icsWith, openApp, privateText, putPrivateFiles, runCommand, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const list = (page: Page) => page.getByRole('list', { name: 'Calendars' });
const row = (page: Page, name: string) => list(page).getByRole('listitem').filter({ hasText: name });
const week = (page: Page) => page.getByRole('main', { name: 'Week view' });

const trashNames = (page: Page) =>
  page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('calendars');
    try {
      const trash = await (await root.getDirectoryHandle('.daybird')).getDirectoryHandle('trash');
      const names: string[] = [];
      for await (const [name] of trash.entries()) names.push(name);
      return names;
    } catch {
      return [];
    }
  });

async function menuOf(page: Page, name: string) {
  await row(page, name).hover();
  await row(page, name)
    .getByRole('button', { name: `${name} options` })
    .click();
  const menu = page.getByRole('menu', { name: `${name} menu` });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Show Calendar' })).toBeFocused();
  return menu;
}

test.describe('Sidebar calendars', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1F77D0', [
        'DTSTART:20261117T150000Z\nDTEND:20261117T160000Z\nSUMMARY:Standup',
      ]),
      'Home.ics': icsWith('Home', '#30A46C', [
        'DTSTART:20261118T090000Z\nDTEND:20261118T100000Z\nSUMMARY:Plumber',
      ]),
    });
  });

  test('a checkbox hides a calendar’s events on this device, and a reload keeps it hidden', async ({
    page,
  }) => {
    const standup = week(page).getByRole('button', { name: /^Standup/ });
    await expect(standup).toBeVisible();
    await row(page, 'Work').getByRole('checkbox').uncheck();
    await expect(standup).toHaveCount(0);
    await page.reload();
    await expect(row(page, 'Work').getByRole('checkbox')).not.toBeChecked();
    await expect(week(page).getByRole('button', { name: /^Plumber/ })).toBeVisible();
    await expect(standup).toHaveCount(0);
    await row(page, 'Work').getByRole('checkbox').check();
    await expect(standup).toBeVisible();
  });

  test('the mini month dots days with events, and the sidebar’s edge sets its width', async ({ page }) => {
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    await expect(
      sidebar.getByRole('gridcell', { name: 'Tuesday, November 17, 2026, 1 event' }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole('gridcell', { name: 'Thursday, November 19, 2026', exact: true }),
    ).toBeVisible();
    const edge = sidebar.getByRole('separator', { name: 'Sidebar width' });
    await expect(edge).toHaveAttribute('aria-valuenow', '240');
    await edge.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(edge).toHaveAttribute('aria-valuenow', '290');
    const box = (await edge.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 200);
    await page.mouse.up();
    await expect(edge).toHaveAttribute('aria-valuenow', '360');
    await page.reload();
    await expect(sidebar.getByRole('separator', { name: 'Sidebar width' })).toHaveAttribute(
      'aria-valuenow',
      '360',
    );
  });

  test('adds a calendar in a file of its own, and renames one undoably', async ({ page }) => {
    await page.getByRole('button', { name: 'New Calendar', exact: true }).click();
    const add = page.getByRole('dialog', { name: 'New Calendar' });
    await page.keyboard.type('Trips');
    await add.getByRole('button', { name: 'Add' }).click();
    await expect(row(page, 'Trips')).toBeVisible();
    await expect.poll(() => privateText(page, 'Trips.ics')).toContain('X-WR-CALNAME:Trips');

    await row(page, 'Home').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename…' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename Home' });
    await expect(rename.getByRole('textbox')).toBeFocused();
    await page.keyboard.type('House');
    await page.keyboard.press('Enter');
    await expect(row(page, 'House')).toBeVisible();
    await expect.poll(() => privateText(page, 'Home.ics')).toContain('X-WR-CALNAME:House');
    await runCommand(page, 'Undo');
    await expect(row(page, 'Home')).toBeVisible();
    await expect.poll(() => privateText(page, 'Home.ics')).toContain('X-WR-CALNAME:Home');
  });

  test('changes a colour, sets the default, and deletes to the folder’s trash after asking', async ({
    page,
  }) => {
    await (await menuOf(page, 'Work')).getByRole('menuitem', { name: 'Colour…' }).click();
    await page.getByRole('dialog', { name: 'Colour of Work' }).getByRole('radio', { name: 'Red' }).click();
    await expect.poll(() => privateText(page, 'Work.ics')).toContain('X-APPLE-CALENDAR-COLOR:#E5484D');

    await (await menuOf(page, 'Home')).getByRole('menuitemcheckbox', { name: 'Set as Default' }).click();
    await expect(row(page, 'Home')).toContainText('Default');
    await expect.poll(() => privateText(page, '.daybird/settings.json')).toContain('"Home.ics"');
    await expect(
      (await menuOf(page, 'Home')).getByRole('menuitemcheckbox', { name: 'Set as Default' }),
    ).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await (await menuOf(page, 'Work')).getByRole('menuitem', { name: 'Delete Calendar…' }).click();
    const ask = page.getByRole('dialog', { name: 'Delete Work?' });
    await expect(ask).toContainText('1 event');
    await ask.getByRole('button', { name: 'Delete' }).click();
    await expect(row(page, 'Work')).toHaveCount(0);
    await expect(week(page).getByRole('button', { name: /^Standup/ })).toHaveCount(0);
    await expect.poll(() => privateText(page, 'Work.ics')).toBeNull();
    await expect.poll(() => trashNames(page)).toEqual([expect.stringMatching(/^Work .*\.ics$/)]);
    await expect(page.getByRole('status')).toContainText('Deleted Work.');
  });
});
