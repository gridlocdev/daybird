// Desktop smoke test: the built Electron app starts headless (no window, Dock icon or system dialog) on a throwaway
// profile and shows the calendar. `just e2e-desktop` builds it first. The throwaway profile matters: the app must
// never read the owner's settings or calendars.
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { expect, test, waitForApp, watchErrors } from './fixtures.ts';

const DESKTOP = fileURLToPath(new URL('../apps/desktop', import.meta.url));

test.describe('Desktop, browser and NAS', () => {
  test('the desktop app starts headless, asks for a folder once and keeps calendars in it', async () => {
    // realpath: macOS's temp folder is behind a symlink, and the app may report or compare the real path.
    const temp = realpathSync(mkdtempSync(path.join(tmpdir(), 'daybird-e2e-')));
    const profile = path.join(temp, 'profile');
    const documents = path.join(temp, 'Documents');
    const launch = () =>
      electron.launch({
        cwd: DESKTOP,
        // The main script by name (the built one package.json points at), so nothing else is read as an argument.
        args: ['out/main.js'],
        env: {
          ...process.env,
          DAYBIRD_HEADLESS: '1',
          DAYBIRD_USER_DATA: profile,
          DAYBIRD_DOCUMENTS: documents,
        },
      });
    try {
      const app = await launch();
      try {
        expect(await app.evaluate(({ app }) => app.getPath('userData')), 'the throwaway profile').toBe(
          profile,
        );
        const window = await app.firstWindow();
        const errors = watchErrors(window);
        await waitForApp(window);
        const ask = window.getByRole('dialog', { name: 'Where should Daybird keep calendars?' });
        await expect(ask).toBeVisible();
        await ask.getByRole('button', { name: 'Use Documents/Daybird' }).click();
        await expect(ask).toBeHidden();
        await expect(window.getByRole('main', { name: 'Week view' })).toBeVisible();
        await expect
          .poll(() => existsSync(path.join(documents, 'Daybird', 'Calendar.ics')), {
            message: 'the first calendar is a file in the chosen folder',
          })
          .toBe(true);
        expect(
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible())),
          'no window shows on the screen',
        ).toBe(false);
        expect(errors).toEqual([]);
      } finally {
        await app.close();
      }

      const again = await launch();
      try {
        const window = await again.firstWindow();
        const errors = watchErrors(window);
        await waitForApp(window);
        await expect(window.locator('.db-status .db-where'), 'the folder is remembered').toHaveText(
          'Daybird',
        );
        await expect(window.getByRole('dialog')).toHaveCount(0);
        expect(errors).toEqual([]);
      } finally {
        await again.close();
      }
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
