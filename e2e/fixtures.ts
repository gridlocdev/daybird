// Shared scenario setup. `seed('basic')` replaces .e2e-data with a copy of e2e/fixtures/basic,
// so each test starts from known files and nothing one test writes leaks into the next.
// Every page runs on a clock that starts at NOW and keeps going, so the fixtures' dates mean the same on every run;
// `page.clock.runFor(ms)` moves it on, which checks a timer (an autosave, a periodic refresh) without waiting for it.
import { expect, test as base, type Page } from '@playwright/test';
import { NOW, seedData } from './server.ts';

export { expect };
export { cli, DATA, NOW, readData, readDataIfThere, seedData, writeData } from './server.ts';

export const test = base.extend<{ seed: (fixture: string) => void }>({
  page: async ({ page }, use) => {
    await page.clock.install({ time: NOW });
    await use(page);
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright reads fixture names from this pattern.
  seed: async ({}, use) => {
    await use(seedData);
  },
});

/**
 * Open the app the way a user does, and wait until it shows the fixture. The page loads before the app has
 * picked its store and drawn, and a key pressed sooner goes nowhere.
 */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await waitForApp(page);
}

/** The app has drawn: the view and the range title are on the page. */
export async function waitForApp(page: Page): Promise<void> {
  await page.getByRole('main').waitFor();
  await page.locator('h1.db-range-title').waitFor();
}

/**
 * Failed requests the app expects and handles, by status, method and URL: a file it reads before it exists, a
 * create-only write of a file that is already there. Everything else that fails is an error.
 */
const EXPECTED: readonly { status: number; method: string; url: RegExp }[] = [];

/**
 * Collect what went wrong on the page: uncaught errors, console errors and failed requests. The browser's own
 * "Failed to load resource" line names no URL, so the request is reported instead, with its URL.
 */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      errors.push(message.text());
    }
  });
  page.on('response', (response) => {
    const status = response.status();
    const method = response.request().method();
    const url = response.url();
    if (
      status >= 400 &&
      !EXPECTED.some((e) => e.status === status && e.method === method && e.url.test(url))
    ) {
      errors.push(`${status} ${method} ${url}`);
    }
  });
  return errors;
}

/**
 * The ⌘K menu: a dialog named "Command menu" (any case) holding a combobox, with an option for each entry. If
 * the app's differs, fix the app (screen readers need the same): name the dialog, and give the rows the option
 * role. A list popup shared by several pickers takes its name as a prop, so each picker gets its own.
 */
export const commandMenu = (page: Page) => page.getByRole('dialog', { name: 'Command menu' });

/**
 * Run a command from ⌘K by its name. Type the way a person does: wait until focus is in the field, then use the
 * keyboard. `fill()` right after a field appears can land before the component has set itself up, and be lost.
 */
export async function runCommand(page: Page, name: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+KeyK');
  const menu = commandMenu(page);
  await expect(menu.getByRole('combobox')).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
}

/**
 * Put calendar files in the browser's private folder, where the browser build keeps them, then reload so the app
 * reads them. `files` maps a file name to its text.
 */
export async function putPrivateFiles(page: Page, files: Record<string, string>): Promise<void> {
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('calendars', { create: true });
    for (const [name, text] of Object.entries(files)) {
      const w = await (await folder.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
  }, files);
  await page.reload();
  await waitForApp(page);
}

/** A calendar file with the given VEVENT bodies (each without BEGIN/END), made-up data. */
export function icsWith(name: string, colour: string, events: readonly string[]): string {
  const body = events
    .map(
      (e, i) =>
        `BEGIN:VEVENT\r\nUID:e2e-${i}@example.com\r\nDTSTAMP:20261101T000000Z\r\n${e
          .trim()
          .split('\n')
          .map((l) => l.trim())
          .join('\r\n')}\r\nEND:VEVENT\r\n`,
    )
    .join('');
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//Example//EN\r\nX-WR-CALNAME:${name}\r\nX-APPLE-CALENDAR-COLOR:${colour}\r\n${body}END:VCALENDAR\r\n`;
}
