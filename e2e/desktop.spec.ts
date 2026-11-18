// Desktop smoke test: the built Electron app starts headless (no window, Dock icon or system dialog) on a throwaway
// profile and shows the calendar. `just e2e-desktop` builds it first. The throwaway profile matters: the app must
// never read the owner's settings or calendars.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { expect, test, waitForApp, watchErrors } from './fixtures.ts';

const DESKTOP = fileURLToPath(new URL('../apps/desktop', import.meta.url));

test.describe('Desktop, browser and NAS', () => {
  test('the desktop app starts headless on a throwaway profile and shows the calendar', async () => {
    // realpath: macOS's temp folder is behind a symlink, and the app may report or compare the real path.
    const temp = realpathSync(mkdtempSync(path.join(tmpdir(), 'daybird-e2e-')));
    const profile = path.join(temp, 'profile');
    const app = await electron.launch({
      cwd: DESKTOP,
      // The main script by name (the built one package.json points at), so nothing else is read as an argument.
      args: ['out/main.js'],
      env: { ...process.env, DAYBIRD_HEADLESS: '1', DAYBIRD_USER_DATA: profile },
    });
    try {
      expect(await app.evaluate(({ app }) => app.getPath('userData')), 'the throwaway profile').toBe(profile);
      const window = await app.firstWindow();
      const errors = watchErrors(window);
      await waitForApp(window);
      await expect(window.getByRole('main', { name: 'Week view' })).toBeVisible();
      expect(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible())),
        'no window shows on the screen',
      ).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
