// Reminders (PRD §9): the popover's field, and a reminder ringing once at its time. The page clock is Tuesday
// 17 November 2026, 14:00 UTC, and the display zone is UTC.
import { expect, icsWith, openApp, privateText, putPrivateFiles, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const popover = (page: Page) => page.getByRole('dialog', { name: /^Edit / });
const day = (page: Page) => page.getByRole('main', { name: 'Day view' });
const event = (page: Page, name: string) => day(page).getByRole('button', { name: new RegExp(`^${name}`) });
const MINUTE = 60_000;

const alarm = (trigger: string) =>
  `BEGIN:VALARM\nACTION:DISPLAY\nDESCRIPTION:Reminder\n${trigger}\nEND:VALARM`;

/** Notifications the page put up, recorded in place of real ones; permission is already granted. */
async function recordNotifications(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shown: { title: string; body: string }[] = [];
    class Recorded {
      static permission = 'granted';
      static requestPermission = () => Promise.resolve('granted');
      onclick: (() => void) | null = null;
      constructor(title: string, options: { body: string }) {
        shown.push({ title, body: options.body });
      }
      close() {}
    }
    Object.assign(globalThis, { Notification: Recorded, shownNotifications: shown });
  });
}

const notifications = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { shownNotifications: unknown[] }).shownNotifications);

test.describe('Reminders', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    page.setDefaultTimeout(5000);
    await recordNotifications(page);
    await openApp(page);
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1F77D0', [
        `DTSTART:20261117T151000Z\nDTEND:20261117T160000Z\nSUMMARY:Standup\nLOCATION:Room 4\n${alarm('TRIGGER:-PT10M')}`,
        `DTSTART:20261117T140500Z\nDTEND:20261117T143000Z\nSUMMARY:Call\n${alarm('TRIGGER:-PT30M')}`,
        `DTSTART:20261117T124000Z\nDTEND:20261117T130000Z\nSUMMARY:Breakfast\n${alarm('TRIGGER:-PT20M')}`,
        'DTSTART:20261117T170000Z\nDTEND:20261117T180000Z\nSUMMARY:Review',
      ]),
    });
    await page.keyboard.press('d');
  });

  test('a reminder missed less than an hour ago rings on opening, an older one doesn’t', async ({ page }) => {
    await expect(page.getByRole('status')).toContainText('Call: Today at 2:05 PM');
    await expect.poll(() => notifications(page)).toEqual([{ title: 'Call', body: 'Today at 2:05 PM' }]);
  });

  test('a reminder rings at its time, once, and Show opens its event', async ({ page }) => {
    await page.clock.runFor(59 * MINUTE);
    await expect(page.getByRole('status')).not.toContainText('Standup');
    await page.clock.runFor(2 * MINUTE);
    await expect(page.getByRole('status')).toContainText('Standup: Today at 3:10 PM · Room 4');
    await expect.poll(async () => (await notifications(page)).length).toBe(2);
    await page.getByRole('contentinfo').getByRole('button', { name: 'Show' }).click();
    await expect(event(page, 'Standup')).toHaveAttribute('aria-pressed', 'true');
    await openApp(page);
    await page.clock.runFor(2 * MINUTE);
    expect(await notifications(page)).toEqual([]);
  });

  test('the popover adds, changes and removes reminders, and saves them', async ({ page }) => {
    await event(page, 'Review').dblclick();
    await popover(page).getByRole('button', { name: 'Add Reminder' }).click();
    const first = popover(page).getByRole('combobox', { name: 'Reminder 1', exact: true });
    await expect(first).toHaveValue('2');
    await first.selectOption({ label: '1 hour before' });
    await popover(page).getByRole('button', { name: 'Add Reminder' }).click();
    await popover(page).getByRole('combobox', { name: 'Reminder 2', exact: true }).selectOption('Custom…');
    await popover(page).getByRole('spinbutton', { name: 'Reminder 2 amount' }).fill('3');
    await popover(page).getByRole('combobox', { name: 'Reminder 2 unit' }).selectOption('days');
    await popover(page).getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => privateText(page, 'Work.ics')).toMatch(/TRIGGER:-PT1H[\s\S]*TRIGGER:-P3D/);
    await event(page, 'Review').dblclick();
    await expect(popover(page).getByRole('combobox', { name: 'Reminder 2', exact: true })).toHaveValue(
      'custom',
    );
    await popover(page).getByRole('button', { name: 'Remove reminder 1' }).click();
    await popover(page).getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => privateText(page, 'Work.ics')).not.toContain('TRIGGER:-PT1H');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => privateText(page, 'Work.ics')).toContain('TRIGGER:-PT1H');
  });

  test('with notifications off, a reminder rings in the window only', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+Comma');
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByLabel('Show notifications').uncheck();
    await settings.getByRole('button', { name: 'Done' }).click();
    const before = (await notifications(page)).length;
    await page.clock.runFor(61 * MINUTE);
    await expect(page.getByRole('status')).toContainText('Standup');
    expect((await notifications(page)).length).toBe(before);
  });
});
