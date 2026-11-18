// The NAS server (PRD §15): the built client served by `daybird-server --dir`, on the fixture folder. The page
// reads and saves the folder's files through the server, not the browser's storage.
import { spawn, type ChildProcess } from 'node:child_process';
import { DATA, expect, readData, test, waitForApp, writeData } from './fixtures.ts';
import { ROOT } from './server.ts';
import type { Page } from '@playwright/test';

/** Not the scenarios' own server's port, nor another app's. */
const PORT = 8794;
const URL = `http://127.0.0.1:${PORT}/`;
let server: ChildProcess;

const event = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });
const popover = (page: Page) => page.getByRole('dialog', { name: /^Edit / });

test.describe('NAS server', () => {
  test.beforeAll(async () => {
    server = spawn(process.execPath, ['apps/server/src/main.ts', '--dir', DATA, '--port', String(PORT)], {
      cwd: ROOT,
      env: { ...process.env, DAYBIRD_STATIC: `${ROOT}apps/web/dist` },
      stdio: 'ignore',
    });
    await expect
      .poll(
        () =>
          fetch(`${URL}api/info`).then(
            (r) => r.ok,
            () => false,
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test.afterAll(() => {
    server.kill();
  });

  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await page.goto(URL);
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
