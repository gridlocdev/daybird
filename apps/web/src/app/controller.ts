/**
 * The window's state as signals: the view, the anchor date, today, per-device settings, the open dialog and
 * the status-bar notice. Components read these; commands call the methods.
 */
import { batch, computed, signal } from '@preact/signals';
import {
  localeWeekStart,
  rangeTitle,
  stepAnchor,
  todayIn,
  viewRange,
  type Accent,
  type DateRange,
  type PlainDate,
  type RangeTitle,
  type View,
  type Weekday,
} from '@daybird/core';
import {
  HOUR_HEIGHTS,
  after,
  resolveWeekStart,
  type Settings,
  type SettingsStorage,
  type Theme,
} from '@daybird/ui';

export type DialogKind = 'commands' | 'shortcuts' | 'settings';

export interface Notice {
  readonly text: string;
  readonly tone?: 'error';
  /** Stays until dismissed or replaced. Errors are sticky. */
  readonly sticky?: boolean;
  readonly action?: { readonly label: string; readonly run: () => void };
}

/** How long a notice stays: 6 s, or 12 s with an action such as Undo (PRD §5.5). */
export const NOTICE_MS = 6_000;
export const NOTICE_ACTION_MS = 12_000;

export interface ControllerOptions {
  readonly settings: SettingsStorage;
  readonly version: string;
  /** Milliseconds since the epoch; tests pass a fixed clock. */
  readonly now?: () => number;
  /** The locale for dates; the runtime's when left out. */
  readonly locale?: string;
}

export class AppController {
  readonly version: string;
  readonly locale: string | undefined;
  readonly settings;
  readonly today;
  readonly anchor;
  readonly dialog = signal<DialogKind | null>(null);
  readonly notice = signal<Notice | null>(null);
  /** What the polite live region reads out; the notice text, and other changes worth hearing. */
  readonly announcement = signal('');

  readonly view;
  readonly weekStart;
  readonly range;
  readonly title;

  readonly #storage: SettingsStorage;
  readonly #now: () => number;
  readonly #localeWeekStart: Weekday;
  #clearNotice: (() => void) | null = null;

  constructor(options: ControllerOptions) {
    this.version = options.version;
    this.locale = options.locale;
    this.#storage = options.settings;
    this.#now = options.now ?? Date.now;
    this.#localeWeekStart = localeWeekStart(options.locale);
    this.settings = signal<Settings>(options.settings.load());
    const today = todayIn(this.#now());
    this.today = signal<PlainDate>(today);
    // The app opens on the last view at today (PRD §6).
    this.anchor = signal<PlainDate>(today);
    this.view = computed<View>(() => this.settings.value.view);
    this.weekStart = computed<Weekday>(() =>
      resolveWeekStart(this.settings.value.weekStart, this.#localeWeekStart),
    );
    this.range = computed<DateRange>(() =>
      viewRange(this.view.value, this.anchor.value, this.weekStart.value),
    );
    this.title = computed<RangeTitle>(() =>
      rangeTitle(this.view.value, this.anchor.value, this.weekStart.value, this.locale),
    );
  }

  /** Changes settings and keeps them. */
  update(patch: Partial<Settings>): void {
    const next = { ...this.settings.peek(), ...patch };
    this.settings.value = next;
    this.#storage.save(next);
  }

  setView(view: View): void {
    if (this.view.peek() !== view) this.update({ view });
  }

  /** ‹ and › (PRD §6.5). */
  step(direction: -1 | 1): void {
    this.anchor.value = stepAnchor(this.view.peek(), this.anchor.peek(), direction);
  }

  goToday(): void {
    this.anchor.value = this.today.peek();
  }

  goTo(date: PlainDate): void {
    this.anchor.value = date;
  }

  isShowingToday(): boolean {
    const { start, end } = this.range.peek();
    const today = this.today.peek();
    return today >= start && today < end;
  }

  toggleSidebar(): void {
    this.update({ sidebarShown: !this.settings.peek().sidebarShown });
  }

  setTheme(theme: Theme): void {
    this.update({ theme });
  }

  setAccent(accent: Accent): void {
    this.update({ accent });
  }

  /** ⌘+ and ⌘− (PRD §6.1). */
  zoom(direction: -1 | 1): void {
    const h = this.settings.peek().hourHeight + direction * HOUR_HEIGHTS.step;
    this.update({ hourHeight: Math.min(HOUR_HEIGHTS.max, Math.max(HOUR_HEIGHTS.min, h)) });
  }

  canZoom(direction: -1 | 1): boolean {
    const h = this.settings.peek().hourHeight;
    return direction > 0 ? h < HOUR_HEIGHTS.max : h > HOUR_HEIGHTS.min;
  }

  open(kind: DialogKind): void {
    this.dialog.value = kind;
  }

  /** Opens `kind`, or closes it when it's the one open (⌘K, ⌘/ and ⌘, toggle their own window). */
  toggle(kind: DialogKind): void {
    this.dialog.value = this.dialog.peek() === kind ? null : kind;
  }

  close(): void {
    this.dialog.value = null;
  }

  /** A dialog is open, so plain keys and most commands wait. */
  blocked(): boolean {
    return this.dialog.peek() !== null;
  }

  /** Shows a notice in the status bar and reads it out (PRD §5.5). */
  say(text: string, options: Omit<Notice, 'text'> = {}): void {
    this.#clearNotice?.();
    this.#clearNotice = null;
    const notice: Notice = { text, ...options, sticky: options.sticky ?? options.tone === 'error' };
    batch(() => {
      this.notice.value = notice;
      this.announcement.value = text;
    });
    if (!notice.sticky)
      this.#clearNotice = after(notice.action ? NOTICE_ACTION_MS : NOTICE_MS, () => {
        if (this.notice.peek() === notice) this.notice.value = null;
      });
  }

  dismissNotice(): void {
    this.#clearNotice?.();
    this.#clearNotice = null;
    this.notice.value = null;
  }

  /**
   * The clock ticked (every 30 s, and when the window comes back). At midnight today moves on, and a view
   * that was showing today follows it (PRD §6.1).
   */
  tick(): void {
    const today = todayIn(this.#now());
    const was = this.today.peek();
    if (today === was) return;
    batch(() => {
      const followed = this.isShowingToday() && this.anchor.peek() === was;
      this.today.value = today;
      if (followed) this.anchor.value = today;
    });
  }
}
