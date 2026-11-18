// The command line (PRD §16) on the folder a window has open through the NAS server: what the CLI changes, the
// window picks up, and what the window saves, the CLI reads.
import { cli, expect, readData, startFolderServer, test, waitForApp } from './fixtures.ts';
import type { Page } from '@playwright/test';

/** Not the scenarios' own server's port, the NAS scenarios', nor another app's. */
const PORT = 8796;
let server: { url: string; stop: () => void };

const day = (page: Page) => page.getByRole('main', { name: 'Day view' });
const event = (page: Page, name: string) => day(page).getByRole('button', { name: new RegExp(`^${name}`) });
const popover = (page: Page) => page.getByRole('dialog', { name: /^Edit / });
const focus = (page: Page) => page.evaluate(() => dispatchEvent(new Event('focus')));

interface Listed {
  uid: string;
  title: string;
  start: string;
}

test.describe('Command line', () => {
  test.beforeAll(async () => {
    server = await startFolderServer(PORT);
  });

  test.afterAll(() => server.stop());

  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await page.goto(server.url);
    await waitForApp(page);
    await page.keyboard.press('d');
  });

  test('an event the CLI adds, changes and deletes shows in the open window', async ({ page }) => {
    const made = JSON.parse(
      cli(
        'add',
        'Dentist',
        '--start',
        '2026-11-17T16:00',
        '--duration',
        '45m',
        '--calendar',
        'Work',
        '--json',
      ),
    ) as { uid: string };
    await focus(page);
    await expect(event(page, 'Dentist')).toHaveCount(1);
    await expect(page.getByRole('contentinfo')).toContainText('Updated Work with 1 change made elsewhere');

    cli('edit', made.uid, '--title', 'Dentist (moved)', '--start', '2026-11-17T17:00');
    await focus(page);
    await expect(event(page, 'Dentist \\(moved\\)')).toHaveCount(1);

    expect(cli('delete', made.uid)).toBe('Moved “Dentist (moved)” from Work to the Trash.');
    await focus(page);
    await expect(event(page, 'Dentist')).toHaveCount(0);
    expect(readData('.daybird/trash.ics')).toContain('SUMMARY:Dentist (moved)');
  });

  test('the CLI lists what the window saved', async ({ page }) => {
    await event(page, 'Planning meeting').dblclick();
    await popover(page).getByRole('textbox', { name: 'Title' }).fill('Planning');
    await popover(page).getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => readData('Work.ics')).toContain('SUMMARY:Planning\r\n');
    const today = JSON.parse(cli('list', '--from', '2026-11-17', '--json')) as Listed[];
    expect(today.map((o) => [o.uid, o.title, o.start])).toContainEqual([
      'work-1@daybird.test',
      'Planning',
      '2026-11-17T09:30',
    ]);
  });
});
