import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, keyFocus, memorySettings, parseSettings, resolveWeekStart } from '../src/index.ts';

describe('settings', () => {
  it('keeps good fields and defaults bad ones one by one', () => {
    const s = parseSettings({
      theme: 'dark',
      accent: 'magenta',
      weekStart: 1,
      hourHeight: 500,
      view: 'month',
      hiddenCalendars: ['work.ics', 3],
      eventMinutes: 30,
    });
    expect(s.theme).toBe('dark');
    expect(s.accent).toBe('blue');
    expect(s.weekStart).toBe(1);
    expect(s.hourHeight).toBe(48);
    expect(s.view).toBe('month');
    expect(s.hiddenCalendars).toEqual([]);
    expect(s.eventMinutes).toBe(30);
  });

  it('reads anything that is not an object as the defaults', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('dark')).toEqual(DEFAULT_SETTINGS);
  });

  it('resolves the week start from the locale only when asked to', () => {
    expect(resolveWeekStart('locale', 1)).toBe(1);
    expect(resolveWeekStart(6, 1)).toBe(6);
  });

  it('keeps settings in memory for tests', () => {
    const storage = memorySettings({ theme: 'light' });
    expect(storage.load().theme).toBe('light');
    storage.save({ ...storage.load(), accent: 'teal' });
    expect(storage.load().accent).toBe('teal');
  });

  it('treats nothing focused as the calendar', () => {
    expect(keyFocus(null)).toBe('list');
  });
});
