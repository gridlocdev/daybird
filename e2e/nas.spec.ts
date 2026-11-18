// The NAS server (PRD §15): the built client served by `daybird-server --dir`, on the fixture folder. The page
// reads and saves the folder's files through the server, not the browser's storage.
import { expect, readData, startFolderServer, test, waitForApp, writeData } from './fixtures.ts';
import type { Page } from '@playwright/test';

/** Not the scenarios' own server's port, nor another app's. */
const PORT = 8794;
let server: { url: string; stop: () => void };

const event = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });
const popover = (page: Page) => page.getByRole('dialog', { name: /^Edit / });

test.describe('NAS server', () => {
  test.beforeAll(async () => {
    server = await startFolderServer(PORT);
  });

  test.afterAll(() => server.stop());

  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await page.goto(server.url);
    await waitForApp(page);
  });

  test('shows the folder’s calendars and saves an edit to its file', async ({ page }) => {
    await expect(page.getByRole('contentinfo')).toContainText('.e2e-data');
    await expect(page.getByText('Stored in this browser')).toHaveCount(0);
    await event(page, 'Planning meeting').dblclick();
    await popover(page).getByRole('textbox', { name: 'Title' }).fill('Planning');
    await popover(page).getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => readData('Work.ics')).toContain('SUMMARY:Planning\r\n');
    await page.reload();
    await waitForApp(page);
    await expect(event(page, 'Planning')).toHaveCount(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('picks up a change made on the NAS by another program', async ({ page }) => {
    await expect(event(page, 'Planning meeting')).toHaveCount(1);
    writeData('Work.ics', readData('Work.ics').replace('Planning meeting', 'Planning session'));
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await expect(event(page, 'Planning session')).toHaveCount(1);
    await expect(page.getByRole('contentinfo')).toContainText('Updated Work with 1 change made elsewhere');
  });
});
