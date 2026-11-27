// Keyboard focus comes from the app's state (PRD §17). The page clock is Tuesday 17 November 2026, 14:00 UTC, and
// the display zone is UTC.
import { expect, icsWith, openApp, putPrivateFiles, test } from './fixtures.ts';
import type { Locator, Page } from '@playwright/test';

const event = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name},`) });
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });

/** The focused element's outline, and the ring colour the theme's token gives. */
const ring = (target: Locator) =>
  target.evaluate((el) => {
    const style = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.color = 'var(--db-focus)';
    document.body.append(probe);
    const token = getComputedStyle(probe).color;
    probe.remove();
    return {
      focused: document.activeElement === el,
      style: style.outlineStyle,
      colour: style.outlineColor,
      token,
    };
  });

test.describe('Keyboard focus', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
    await putPrivateFiles(page, {
      'Work.ics': icsWith('Work', '#1F77D0', [
        'DTSTART:20261117T090000Z\nDTEND:20261117T100000Z\nSUMMARY:Standup',
        'DTSTART:20261118T120000Z\nDTEND:20261118T130000Z\nSUMMARY:Lunch',
      ]),
    });
    await event(page, 'Standup').scrollIntoViewIfNeeded();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`a click shows no browser outline and the keyboard shows the theme's ring (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const today = page.getByRole('button', { name: 'Today', exact: true });
      await today.click();
      expect(await ring(today)).toMatchObject({ focused: true, style: 'none' });
      await page.keyboard.press('Tab');
      const next = page.locator(':focus');
      const shown = await ring(next);
      expect(shown.style).toBe('solid');
      expect(shown.colour).toBe(shown.token);
    });
  }

  test('a click selects an event and focuses it, and a keyboard move and undo keep focus on it', async ({
    page,
  }) => {
    const standup = event(page, 'Standup');
    await standup.click();
    await expect(standup).toHaveAttribute('aria-pressed', 'true');
    await expect(standup).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(standup).toHaveAccessibleName(/^Standup, 9:15 AM/);
    await expect(standup).toBeFocused();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(standup).toHaveAccessibleName(/^Standup, 9:00 AM/);
    await expect(standup).toBeFocused();
    await expect(standup).toHaveAttribute('aria-pressed', 'true');
  });

  test('focusing an event selects it, the way Tab does', async ({ page }) => {
    const standup = event(page, 'Standup');
    const lunch = event(page, 'Lunch');
    await standup.click();
    await lunch.focus();
    await expect(lunch).toHaveAttribute('aria-pressed', 'true');
    await expect(standup).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Shift+Tab');
    await expect(standup).toBeFocused();
    await expect(standup).toHaveAttribute('aria-pressed', 'true');
    await expect(lunch).toHaveAttribute('aria-pressed', 'false');
  });

  test('closing the popover gives focus back to its event, even after an edit drew it again', async ({
    page,
  }) => {
    const standup = event(page, 'Standup');
    await standup.click();
    await page.keyboard.press('Enter');
    const popover = page.getByRole('dialog', { name: /^Edit / });
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(standup).toBeFocused();

    await standup.dblclick();
    await expect(popover).toBeVisible();
    await popover.getByRole('textbox', { name: 'Title' }).fill('Standup moved');
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(event(page, 'Standup moved')).toBeFocused();
    await expect(event(page, 'Standup moved')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the mini month has one tab stop, the shown day, and the arrows move it', async ({ page }) => {
    const days = sidebar(page).getByRole('gridcell');
    const stop = sidebar(page).locator('[role="gridcell"][tabindex="0"]');
    await expect(sidebar(page).locator('.db-mini-weekday')).toContainText(['Tu', 'We', 'Th']);
    await expect(stop).toHaveCount(1);
    await expect(stop).toHaveAccessibleName(/November 17, 2026/);
    await stop.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(':focus')).toHaveAccessibleName(/November 18, 2026/);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(':focus')).toHaveAccessibleName(/November 25, 2026/);
    await page.keyboard.press('PageDown');
    await expect(page.locator(':focus')).toHaveAccessibleName(/December 25, 2026/);
    await expect(page.locator('h1.db-range-title')).toContainText('Dec 20');
    await expect(sidebar(page).locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);
    expect(await days.count()).toBeGreaterThan(27);
  });

  test("Settings' appearance is one tab stop, and the arrows choose", async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+,');
    const group = page.getByRole('radiogroup', { name: 'Appearance' });
    const chosen = group.getByRole('radio', { checked: true });
    await chosen.focus();
    const before = await chosen.textContent();
    await page.keyboard.press('ArrowRight');
    const now = group.getByRole('radio', { checked: true });
    await expect(now).not.toHaveText(before ?? '');
    await expect(now).toBeFocused();
    await expect(group.locator('[tabindex="0"]')).toHaveCount(1);
  });
});
