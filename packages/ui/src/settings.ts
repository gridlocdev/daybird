/**
 * Per-device settings (PRD §13): kept in this browser profile or this desktop app, never in the calendar
 * folder. The folder's own settings (the default calendar) live in `.daybird/settings.json` with the data.
 */
import { isAccent, isView, type Accent, type View, type Weekday } from '@daybird/core';

export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** 'locale': the locale's first day; otherwise 0 (Sunday), 1 (Monday) or 6 (Saturday). */
export type WeekStartSetting = 'locale' | 0 | 1 | 6;
export type TimeFormat = 'locale' | '12' | '24';

export const HOUR_HEIGHTS = { min: 32, max: 96, step: 8 } as const;
export const EVENT_LENGTHS = [15, 30, 45, 60, 90, 120] as const;
export const SIDEBAR_WIDTHS = { min: 200, max: 360 } as const;

export interface Settings {
  readonly theme: Theme;
  readonly accent: Accent;
  readonly weekStart: WeekStartSetting;
  /** Where Day and Week scroll to when today isn't shown (0–23). */
  readonly firstHour: number;
  /** Pixels per hour in Day and Week. */
  readonly hourHeight: number;
  readonly weekNumbers: boolean;
  readonly timeFormat: TimeFormat;
  readonly timeZoneSupport: boolean;
  /** The zone times show in while time zone support is on; null is the system's (§4.3). */
  readonly displayZone: string | null;
  /** Minutes a new event lasts. */
  readonly eventMinutes: number;
  readonly notifications: boolean;
  /** The view the app opens on. */
  readonly view: View;
  readonly sidebarShown: boolean;
  readonly sidebarWidth: number;
  /** Calendar file names hidden in this window (§13). */
  readonly hiddenCalendars: readonly string[];
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  accent: 'blue',
  weekStart: 'locale',
  firstHour: 8,
  hourHeight: 48,
  weekNumbers: false,
  timeFormat: 'locale',
  timeZoneSupport: false,
  displayZone: null,
  eventMinutes: 60,
  notifications: true,
  view: 'week',
  sidebarShown: true,
  sidebarWidth: 240,
  hiddenCalendars: [],
};

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * Settings from stored JSON, field by field: a field that's missing or wrong takes its default, so one bad
 * value (an older version's, a hand edit) never throws the rest away.
 */
export function parseSettings(raw: unknown): Settings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const pick = <T>(value: unknown, ok: (v: unknown) => v is T, fallback: T): T =>
    ok(value) ? value : fallback;
  const oneOf =
    <T>(items: readonly T[]) =>
    (v: unknown): v is T =>
      items.includes(v as T);
  const bool = (v: unknown): v is boolean => typeof v === 'boolean';
  return {
    theme: pick(o.theme, oneOf(THEMES), d.theme),
    accent: pick(o.accent, isAccent, d.accent),
    weekStart: pick(o.weekStart, oneOf<WeekStartSetting>(['locale', 0, 1, 6]), d.weekStart),
    firstHour: pick(o.firstHour, (v): v is number => isInt(v, 0, 23), d.firstHour),
    hourHeight: pick(
      o.hourHeight,
      (v): v is number => isInt(v, HOUR_HEIGHTS.min, HOUR_HEIGHTS.max),
      d.hourHeight,
    ),
    weekNumbers: pick(o.weekNumbers, bool, d.weekNumbers),
    timeFormat: pick(o.timeFormat, oneOf<TimeFormat>(['locale', '12', '24']), d.timeFormat),
    timeZoneSupport: pick(o.timeZoneSupport, bool, d.timeZoneSupport),
    displayZone: pick(
      o.displayZone,
      (v): v is string | null => v === null || typeof v === 'string',
      d.displayZone,
    ),
    eventMinutes: pick(o.eventMinutes, oneOf<number>(EVENT_LENGTHS), d.eventMinutes),
    notifications: pick(o.notifications, bool, d.notifications),
    view: pick(o.view, isView, d.view),
    sidebarShown: pick(o.sidebarShown, bool, d.sidebarShown),
    sidebarWidth: pick(
      o.sidebarWidth,
      (v): v is number => isInt(v, SIDEBAR_WIDTHS.min, SIDEBAR_WIDTHS.max),
      d.sidebarWidth,
    ),
    hiddenCalendars: pick(
      o.hiddenCalendars,
      (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string'),
      d.hiddenCalendars,
    ),
  };
}

/** The week's first day for a setting, given the locale's. */
export function resolveWeekStart(setting: WeekStartSetting, localeStart: Weekday): Weekday {
  return setting === 'locale' ? localeStart : setting;
}

/** Where settings are kept. */
export interface SettingsStorage {
  load(): Settings;
  save(settings: Settings): void;
}

const KEY = 'daybird.settings';

/**
 * Settings in `localStorage`. A browser that refuses storage (private windows, blocked site data) still
 * runs: settings then last until the window closes.
 */
export function localSettings(): SettingsStorage {
  return {
    load() {
      let text: string | null;
      try {
        text = localStorage.getItem(KEY);
      } catch {
        return DEFAULT_SETTINGS;
      }
      if (text === null) return DEFAULT_SETTINGS;
      try {
        return parseSettings(JSON.parse(text));
      } catch {
        return DEFAULT_SETTINGS;
      }
    },
    save(settings) {
      try {
        localStorage.setItem(KEY, JSON.stringify(settings));
      } catch (e) {
        console.warn('Settings were not kept:', e);
      }
    },
  };
}

/** Settings held in memory, for tests. */
export function memorySettings(
  initial: Partial<Settings> = {},
): SettingsStorage & { saved: Settings | null } {
  let current: Settings = { ...DEFAULT_SETTINGS, ...initial };
  return {
    saved: null,
    load: () => current,
    save(settings) {
      current = settings;
      this.saved = settings;
    },
  };
}
