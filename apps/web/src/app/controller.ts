/**
 * The window's state as signals: the view, the anchor date, today, per-device settings, the open dialog and
 * the status-bar notice. Components read these; commands call the methods.
 */
import { batch, computed, signal, type Signal } from '@preact/signals';
import {
  addDays,
  dayBounds,
  localeWeekStart,
  occurrencesIn,
  systemZoneId,
  rangeTitle,
  stepAnchor,
  todayIn,
  viewRange,
  type Accent,
  type Calendar,
  type DateRange,
  type Occurrence,
  type PlainDate,
  type RangeTitle,
  type View,
  type Weekday,
} from '@daybird/core';
import {
  HOUR_HEIGHTS,
  after,
  type FolderSession,
  resolveWeekStart,
  type Settings,
  type SettingsStorage,
  type Theme,
} from '@daybird/ui';

/** Which occurrence is selected: at most one in every view (PRD §6). */
export interface OccurrenceRef {
  readonly calendarId: string;
  readonly uid: string;
  readonly key: number | null;
}

export const sameOccurrence = (a: OccurrenceRef | null, b: OccurrenceRef | null): boolean =>
  !!a && !!b && a.calendarId === b.calendarId && a.uid === b.uid && a.key === b.key;

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
  /** The zone the views draw in (PRD §4.3); the system's when left out. */
  readonly displayZone?: string;
  /** The desktop app: the user picks the calendar folder (PRD §3.7). Absent in the browser. */
  readonly folders?: FolderChooser;
}

/** Opening a calendar folder on disk. Each resolves once the folder is open, or the user cancelled. */
export interface FolderChooser {
  choose(): Promise<void>;
  useDefault(): Promise<void>;
}

/** The desktop app has no folder yet (first start), or the last one is gone (PRD §3.7). */
export interface FolderPrompt {
  /** The path of the folder that went missing; null on first start. */
  readonly missing: string | null;
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

  /** The open calendar folder; null until it has loaded. */
  readonly session = signal<FolderSession | null>(null);
  readonly canUndo = computed(() => (this.session.value?.undoStack.value.done.length ?? 0) > 0);
  readonly canRedo = computed(() => (this.session.value?.undoStack.value.undone.length ?? 0) > 0);
  /** The desktop app asks which folder to use. */
  readonly folderPrompt = signal<FolderPrompt | null>(null);
  readonly folders: FolderChooser | null;
  /** A question about the folder waits: which folder, restoring unsaved changes, or a conflict (PRD §3.5–3.7). */
  readonly folderQuestion = computed(
    () =>
      !!this.folderPrompt.value ||
      !!this.session.value?.recovery.value ||
      (this.session.value?.conflicts.value.length ?? 0) > 0,
  );

  readonly view;
  readonly weekStart;
  readonly range;
  readonly title;
  readonly displayZone: string;
  /** Milliseconds since the epoch, moved on by the clock every 30 s: the now line and fading past events. */
  readonly now: Signal<number>;
  readonly calendars = computed<readonly Calendar[]>(
    () => this.session.value?.workspace.value.calendars ?? [],
  );
  /** Every occurrence in the shown range (PRD §6). */
  readonly occurrences;
  readonly selected = signal<OccurrenceRef | null>(null);
  /** The Day and Week all-day strip shows every row, not just four (§6.1). */
  readonly allDayExpanded = signal(false);
  /** How many one-line entries fit in a Month cell, measured from the window (§6.2). */
  readonly monthLanes = signal(3);
  /** The day whose "N more" list is open in Month view (§6.2). */
  readonly dayList = signal<PlainDate | null>(null);

  readonly #storage: SettingsStorage;
  readonly #now: () => number;
  readonly #localeWeekStart: Weekday;
  #clearNotice: (() => void) | null = null;

  constructor(options: ControllerOptions) {
    this.version = options.version;
    this.folders = options.folders ?? null;
    this.locale = options.locale;
    this.#storage = options.settings;
    this.#now = options.now ?? Date.now;
    this.#localeWeekStart = localeWeekStart(options.locale);
    this.displayZone = options.displayZone ?? systemZoneId();
    this.now = signal(this.#now());
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
    this.occurrences = computed<readonly Occurrence[]>(() => {
      const { start, end } = this.range.value;
      const from = dayBounds(start, this.displayZone).start;
      const to = dayBounds(addDays(end, -1), this.displayZone).end;
      return occurrencesIn(this.calendars.value, from, to, this.displayZone);
    });
  }

  select(ref: OccurrenceRef | null): void {
    this.selected.value = ref;
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

  /** Day view on `date`: clicking a day number in Month or Year (§6.2, §6.3). */
  openDay(date: PlainDate): void {
    batch(() => {
      this.dayList.value = null;
      this.goTo(date);
      this.setView('day');
    });
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
    const h = this.settings.value.hourHeight;
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
    return this.dialog.peek() !== null || this.dayList.peek() !== null || this.folderQuestion.peek();
  }

  /** The folder has loaded. */
  attach(session: FolderSession): void {
    batch(() => {
      this.session.value = session;
      this.folderPrompt.value = null;
    });
  }

  /** ⌘O in the desktop app: another calendar folder. */
  openFolder(): void {
    this.folders?.choose().catch((e: unknown) => this.#couldNotOpen(e));
  }

  /** The first-start offer's default: Documents/Daybird. */
  useDefaultFolder(): void {
    this.folders?.useDefault().catch((e: unknown) => this.#couldNotOpen(e));
  }

  #couldNotOpen(e: unknown): void {
    this.say(`Couldn’t open the folder: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
  }

  /** ⌘Z: takes back the last change and says which (PRD §7.6). */
  undo(): void {
    const label = this.session.peek()?.undo();
    if (label) this.say(`Undid ${label}.`);
  }

  /** ⇧⌘Z. */
  redo(): void {
    const label = this.session.peek()?.redo();
    if (label) this.say(`Redid ${label}.`);
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
    this.now.value = this.#now();
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
