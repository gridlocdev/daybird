/**
 * The open calendar folder (PRD §3): the workspace and its undo steps as signals, and each file's save state.
 * Every change goes through `commit`, `undo` or `redo`, which fire `edit` on each file that changed; the save
 * chart (`saveChart.ts`) says what happens next. Outside changes come in through `refresh`, and unsaved changes
 * go to a recovery snapshot every 30 s.
 */
import { batch, computed, signal } from '@preact/signals';
import {
  EMPTY_UNDO,
  calendarById,
  calendarColour,
  clearUndo,
  countEventChanges,
  diffStep,
  emptyCalendarDocument,
  emptyTrashDocument,
  loadCalendar,
  nextCalendarColour,
  purgeTrash,
  pushStep,
  readCalendar,
  redo as redoStep,
  systemZoneId,
  undo as undoStep,
  withCalendar,
  withoutCalendar,
  withoutCalendarSteps,
  type Calendar,
  type EditContext,
  type UndoStack,
  type UndoStep,
  type Workspace,
} from '@daybird/core';
import { ConflictError, encodeText, type CalendarStore } from '../platform/calendarStore.ts';
import { after, every } from '../schedule.ts';
import { hasUnsaved as isUnsaved, step, type SaveEvent, type SaveState } from './saveChart.ts';
import { RecoveryCopies } from './recoveryCopies.ts';
import type { SnapshotFile } from './snapshots.ts';
import {
  conflictOf,
  copyOf,
  docOf,
  nameOf,
  parseDoc,
  readDisk,
  serializeDoc,
  withDoc,
} from './sessionFiles.ts';
import {
  RETRY_DELAYS,
  SNAPSHOT_MS,
  TRASH_PATH,
  isCalendarFile,
  newRecord,
  stamp,
  type Conflict,
  type ConflictChoice,
  type DiskFile,
  type FileRecord,
  type RecoveryOffer,
  type SessionNotice,
  type SessionOptions,
} from './sessionTypes.ts';

export class FolderSession {
  readonly store: CalendarStore;
  readonly workspace = signal<Workspace>({ calendars: [], trash: emptyTrashDocument() });
  readonly undoStack = signal<UndoStack>(EMPTY_UNDO);
  /** Each file's save state, by path. */
  readonly states = signal<ReadonlyMap<string, SaveState>>(new Map());
  /** Files waiting for the user's choice, oldest first; the dialog shows the first. */
  readonly conflicts = signal<readonly Conflict[]>([]);
  readonly recovery = signal<RecoveryOffer | null>(null);
  readonly hasUnsaved = computed(() => [...this.states.value.values()].some(isUnsaved));

  readonly #say: (text: string, options?: SessionNotice) => void;
  readonly #appVersion: string;
  readonly #now: () => number;
  readonly #makeUid: () => string;
  readonly #displayZone: string;
  readonly #files = new Map<string, FileRecord>();
  readonly #copies: RecoveryCopies;
  /** Files that need a save after loading, held back while a recovery offer for them is open. */
  #held: string[] = [];
  #refreshing = false;
  #refreshFailed = false;
  #choosing: Promise<void> = Promise.resolve();
  #stopSnapshots: (() => void) | null = null;
  #closed = false;

  private constructor(options: SessionOptions) {
    this.store = options.store;
    this.#say = options.say;
    this.#appVersion = options.appVersion;
    this.#now = options.now ?? Date.now;
    this.#makeUid = options.makeUid ?? (() => crypto.randomUUID());
    this.#displayZone = options.displayZone ?? systemZoneId();
    this.#copies = new RecoveryCopies(
      options.snapshots,
      `${options.store.kind}:${options.store.name}`,
      this.#now,
      (text) => this.#say(text, { tone: 'error' }),
    );
  }

  /** Opens the folder: reads the recovery snapshots first, then every calendar file and the trash. */
  static async open(options: SessionOptions): Promise<FolderSession> {
    const session = new FolderSession(options);
    await session.#load();
    return session;
  }

  /** The context the engine's edits need. */
  editContext(): EditContext {
    return { now: Math.floor(this.#now() / 1000), makeUid: this.#makeUid, displayZone: this.#displayZone };
  }

  stateOf(path: string): SaveState | null {
    return this.#files.get(path)?.state ?? null;
  }

  /** Makes a change as one undo step and saves every file it touched. Returns false when nothing changed. */
  commit(label: string, next: Workspace): boolean {
    const s = diffStep(label, this.workspace.peek(), next);
    if (!s) return false;
    batch(() => {
      this.workspace.value = next;
      this.undoStack.value = pushStep(this.undoStack.peek(), s);
    });
    this.#edited(s, 'after');
    return true;
  }

  /** Undoes the last step; returns its label, or null when there's nothing to undo. */
  undo(): string | null {
    const r = undoStep(this.workspace.peek(), this.undoStack.peek());
    if (!r) return null;
    batch(() => {
      this.workspace.value = r.workspace;
      this.undoStack.value = r.stack;
    });
    this.#edited(r.step, 'before');
    return r.step.label;
  }

  redo(): string | null {
    const r = redoStep(this.workspace.peek(), this.undoStack.peek());
    if (!r) return null;
    batch(() => {
      this.workspace.value = r.workspace;
      this.undoStack.value = r.stack;
    });
    this.#edited(r.step, 'after');
    return r.step.label;
  }

  /** Try again, after "Couldn't save". */
  tryAgain(path: string): void {
    const rec = this.#files.get(path);
    if (!rec) return;
    rec.attempts = 0;
    this.#fire(path, 'tryAgain');
  }

  /** The user's answer to a conflict. Choices run one at a time; a failure is reported and leaves it open. */
  resolve(path: string, choice: ConflictChoice): Promise<void> {
    this.#choosing = this.#choosing
      .then(() => this.#resolve(path, choice))
      .catch((e: unknown) => {
        this.#say(
          `Couldn’t resolve ${nameOf(this.workspace.peek(), path)}: ${e instanceof Error ? e.message : String(e)}`,
          {
            tone: 'error',
          },
        );
      });
    return this.#choosing;
  }

  /** Restore, in the recovery dialog: the snapshot's files become unsaved changes, saved against their base. */
  restoreRecovery(): void {
    const offer = this.recovery.peek();
    if (!offer) return;
    const latest = this.#copies.latestFiles();
    let next = this.workspace.peek();
    const bases = new Map<string, string | null>();
    for (const { path } of offer.files) {
      const file = latest.get(path);
      if (!file) continue;
      const doc = parseDoc(file.text);
      if (!doc) continue;
      next = withDoc(next, path, doc, this.#makeUid);
      bases.set(path, file.base);
    }
    for (const [path, base] of bases) {
      const rec = this.#record(path);
      rec.base = base;
    }
    this.recovery.value = null;
    void this.#copies.dropOrphans();
    this.commit('Restore Unsaved Changes', next);
    this.#releaseHeld();
  }

  /** Discard, in the recovery dialog. */
  discardRecovery(): void {
    this.recovery.value = null;
    void this.#copies.dropOrphans();
    this.#releaseHeld();
  }

  /** Writes the recovery snapshot now: on closing the window (§3.6). */
  flushSnapshot(): Promise<void> {
    return this.#writeSnapshot();
  }

  /** Stops the session: no more saves, retries or snapshots. The window is closing or another folder opened. */
  close(): void {
    this.#closed = true;
    this.#stopSnapshots?.();
    this.#stopSnapshots = null;
    for (const rec of this.#files.values()) rec.cancelRetry?.();
  }

  /**
   * Picks up changes made elsewhere (§3.5): when the window comes to the front, and every 15 s while it's in
   * front. A file with a write in flight or a conflict open is skipped; a file whose write landed during the read
   * is skipped too, since the read may have seen the window's own write.
   */
  async refresh(): Promise<void> {
    if (this.#refreshing) return;
    this.#refreshing = true;
    try {
      await this.#refresh();
      this.#refreshFailed = false;
    } catch (e) {
      // Said once, not every 15 s, until a refresh works again.
      if (!this.#refreshFailed)
        this.#say(`Couldn’t check the folder for changes: ${e instanceof Error ? e.message : String(e)}`, {
          tone: 'error',
        });
      this.#refreshFailed = true;
    } finally {
      this.#refreshing = false;
    }
  }

  async #refresh(): Promise<void> {
    const entries = await this.store.list('');
    const onDisk = entries.filter((e) => e.kind === 'file' && isCalendarFile(e.name)).map((e) => e.path);
    for (const [path, rec] of [...this.#files]) {
      if (!this.#readyForRefresh(rec)) continue;
      if (path !== TRASH_PATH && rec.base === null) continue;
      const writes = rec.writes;
      const disk = await readDisk(this.store, path);
      if (rec.writes !== writes || !this.#readyForRefresh(rec)) continue;
      if (!disk) {
        if (rec.base !== null) this.#fire(path, 'outsideDelete', null);
      } else if (disk.version !== rec.base) this.#fire(path, 'outsideChange', disk);
    }
    for (const path of onDisk) {
      const rec = this.#files.get(path);
      if (rec && rec.state !== 'removed') continue;
      const disk = await readDisk(this.store, path);
      if (!disk || calendarById(this.workspace.peek(), path)) continue;
      this.#files.delete(path);
      this.#addCalendar(path, disk);
    }
  }

  // ——— Loading ———

  async #load(): Promise<void> {
    // The snapshots come first: nothing may be written before a crashed window's changes are known.
    await this.#copies.load();
    const entries = await this.store.list('');
    const paths = entries
      .filter((e) => e.kind === 'file' && isCalendarFile(e.name))
      .map((e) => e.path)
      .sort((a, b) => a.localeCompare(b));
    const pending: string[] = [];
    for (const path of paths) {
      const disk = await readDisk(this.store, path);
      if (disk && this.#addCalendar(path, disk)) pending.push(path);
    }
    await this.#loadTrash();
    let ws = this.workspace.peek();
    if (!ws.calendars.length) {
      // An empty folder gets one calendar, with no welcome card (§3.1).
      const color = nextCalendarColour([]);
      const calendar: Calendar = {
        id: 'Calendar.ics',
        name: 'Calendar',
        color,
        readOnly: false,
        error: null,
        document: emptyCalendarDocument('Calendar', color),
        problems: [],
      };
      ws = withCalendar(ws, calendar);
      this.#record(calendar.id);
      pending.push(calendar.id);
    }
    const purged = purgeTrash(ws, Math.floor(this.#now() / 1000));
    if (purged !== ws) pending.push(TRASH_PATH);
    this.workspace.value = purged;
    this.#publish();

    const offered = this.#recoveryOffer();
    if (offered.files.length) {
      this.recovery.value = offered;
      const held = new Set(offered.files.map((f) => f.path));
      this.#held = pending.filter((p) => held.has(p));
      for (const p of pending) if (!held.has(p)) this.#fire(p, 'edit');
    } else {
      void this.#copies.dropOrphans();
      for (const p of pending) this.#fire(p, 'edit');
    }
  }

  /** Adds a calendar read from disk, without an undo step. Returns whether it needs saving (UIDs were added). */
  #addCalendar(path: string, disk: DiskFile): boolean {
    const used = this.workspace.peek().calendars.map((c) => c.color);
    const { calendar, changed } = loadCalendar(path, disk.text, this.#makeUid, used);
    const rec = this.#record(path);
    rec.base = disk.version;
    rec.disk = calendar.document;
    this.workspace.value = withCalendar(this.workspace.peek(), calendar);
    this.#publish();
    return changed && !calendar.readOnly;
  }

  async #loadTrash(): Promise<void> {
    const rec = this.#record(TRASH_PATH);
    const disk = await readDisk(this.store, TRASH_PATH);
    if (!disk) return;
    const read = readCalendar(disk.text);
    if (read.ok) {
      rec.base = disk.version;
      rec.disk = read.calendar;
      this.workspace.value = { ...this.workspace.peek(), trash: read.calendar };
      return;
    }
    // A trash file Daybird can't read is moved aside, never written over, and a new one starts.
    await this.store.move(TRASH_PATH, `.daybird/trash unreadable ${stamp(this.#now())}.ics`);
  }

  #recoveryOffer(): RecoveryOffer {
    const latest = this.#copies.latestFiles();
    const files: { path: string; name: string }[] = [];
    for (const [path, file] of latest) {
      const current = docOf(this.workspace.peek(), path);
      if (current && serializeDoc(path, current, this.#appVersion) === file.text) continue;
      if (path !== TRASH_PATH && calendarById(this.workspace.peek(), path)?.readOnly) continue;
      files.push({ path, name: nameOf(this.workspace.peek(), path) });
    }
    return { files, savedAt: this.#copies.savedAt() };
  }

  #releaseHeld(): void {
    const held = this.#held;
    this.#held = [];
    for (const p of held) this.#fire(p, 'edit');
  }

  // ——— The chart ———

  #edited(s: UndoStep, side: 'before' | 'after'): void {
    const ids = [...(side === 'before' ? s.before : s.after).keys()];
    for (const id of ids) this.#fire(id, 'edit');
    if (s.trashBefore || s.trashAfter) this.#fire(TRASH_PATH, 'edit');
  }

  #record(path: string): FileRecord {
    let rec = this.#files.get(path);
    if (!rec) {
      rec = newRecord();
      this.#files.set(path, rec);
    }
    return rec;
  }

  #publish(): void {
    this.states.value = new Map([...this.#files].map(([p, r]) => [p, r.state]));
  }

  #readyForRefresh(rec: FileRecord): boolean {
    return rec.state === 'clean' || rec.state === 'retrying' || rec.state === 'failed';
  }

  /** Moves a file's chart along `event`. `disk` is the file as just read (null: gone), for the effects that take it. */
  #fire(path: string, event: SaveEvent, disk?: DiskFile | null): void {
    if (this.#closed) return;
    const rec = this.#record(path);
    const { to, effects } = step(rec.state, event);
    rec.state = to;
    for (const effect of effects) {
      switch (effect) {
        case 'writeFile':
          void this.#write(path, rec);
          break;
        case 'overwriteFile':
          rec.force = true;
          void this.#write(path, rec);
          break;
        case 'keepCopy':
          rec.unsaved = true;
          this.#stopSnapshots ??= every(SNAPSHOT_MS, () => void this.#writeSnapshot());
          break;
        case 'dropCopy':
          rec.unsaved = false;
          if (![...this.#files.values()].some((r) => r.unsaved)) {
            this.#stopSnapshots?.();
            this.#stopSnapshots = null;
            void this.#copies.save([]);
          }
          break;
        case 'scheduleRetry':
          rec.cancelRetry = after(RETRY_DELAYS[rec.attempts - 1] ?? 600, () => {
            rec.cancelRetry = null;
            this.#fire(path, 'retryTimer');
          });
          break;
        case 'cancelRetry':
          rec.cancelRetry?.();
          rec.cancelRetry = null;
          break;
        case 'report':
          rec.reported = true;
          this.#say(`Couldn’t save ${nameOf(this.workspace.peek(), path)}.`, {
            tone: 'error',
            action: { label: 'Try Again', run: () => this.tryAgain(path) },
          });
          break;
        case 'clearReport':
          if (rec.reported) {
            rec.reported = false;
            this.#say('Saved.');
          }
          break;
        case 'takeFile':
          this.#take(path, rec, disk ?? null, false);
          break;
        case 'replaceWithFile':
          this.#take(path, rec, disk ?? null, true);
          break;
        case 'flag':
          void this.#flag(path, disk);
          break;
        case 'unflag':
          this.conflicts.value = this.conflicts.peek().filter((c) => c.path !== path);
          break;
      }
    }
    this.#publish();
  }

  async #write(path: string, rec: FileRecord): Promise<void> {
    const doc = docOf(this.workspace.peek(), path);
    const calendar = path === TRASH_PATH ? null : calendarById(this.workspace.peek(), path);
    if (!doc || calendar?.readOnly) {
      // Nothing Daybird may write: a calendar that is gone, or a file it couldn't read.
      this.#fire(path, 'saved');
      return;
    }
    const bytes = encodeText(serializeDoc(path, doc, this.#appVersion));
    const opts = rec.force ? {} : rec.base === null ? { create: true } : { expected: rec.base };
    let version: string;
    try {
      version = await this.store.write(path, bytes, opts);
    } catch (e) {
      if (e instanceof ConflictError) {
        rec.attempts = 0;
        this.#fire(path, 'versionChanged');
        return;
      }
      rec.attempts++;
      const final = rec.attempts > RETRY_DELAYS.length;
      if (final) rec.attempts = 0;
      this.#fire(path, final ? 'failedFinal' : 'failed');
      return;
    }
    rec.base = version;
    rec.disk = doc;
    rec.force = false;
    rec.attempts = 0;
    rec.writes++;
    this.#fire(path, 'saved');
  }

  /**
   * Takes the file on disk into the window. Taken as it comes (a refresh), a calendar's changes are one undo step
   * with a notice; taken over the window's changes (the user chose it), the calendar's undo steps go.
   */
  #take(path: string, rec: FileRecord, disk: DiskFile | null, chosen: boolean): void {
    const ws = this.workspace.peek();
    const name = nameOf(this.workspace.peek(), path);
    if (!disk && path === TRASH_PATH) {
      rec.base = null;
      rec.disk = null;
      this.workspace.value = { ...ws, trash: emptyTrashDocument() };
      return;
    }
    if (!disk) {
      batch(() => {
        this.workspace.value = withoutCalendar(ws, path);
        this.undoStack.value = withoutCalendarSteps(this.undoStack.peek(), path);
      });
      rec.base = null;
      rec.disk = null;
      this.#say(`${name} was removed from the folder.`);
      return;
    }
    rec.base = disk.version;
    if (path === TRASH_PATH) {
      const read = readCalendar(disk.text);
      if (!read.ok) return;
      rec.disk = read.calendar;
      this.workspace.value = { ...ws, trash: read.calendar };
      if (chosen) this.undoStack.value = clearUndo();
      return;
    }
    const current = calendarById(ws, path);
    const used = ws.calendars.filter((c) => c.id !== path).map((c) => c.color);
    const loaded = loadCalendar(path, disk.text, this.#makeUid, used);
    const color = calendarColour(loaded.calendar.document) ?? current?.color ?? loaded.calendar.color;
    const calendar = { ...loaded.calendar, color };
    rec.disk = calendar.document;
    const next = withCalendar(ws, calendar);
    if (chosen || calendar.readOnly || current?.readOnly) {
      batch(() => {
        this.workspace.value = next;
        this.undoStack.value = withoutCalendarSteps(this.undoStack.peek(), path);
      });
    } else {
      const s = diffStep('Changes Made Elsewhere', ws, next);
      batch(() => {
        this.workspace.value = next;
        this.undoStack.value = pushStep(this.undoStack.peek(), s);
      });
      const n = current ? countEventChanges(current.document, calendar.document) : 0;
      const changes = n === 1 ? '1 change' : n ? `${n} changes` : 'changes';
      this.#say(`Updated ${calendar.name} with ${changes} made elsewhere.`, {
        action: { label: 'Undo', run: () => void this.undo() },
      });
    }
    if (loaded.changed && !calendar.readOnly) queueMicrotask(() => this.#fire(path, 'edit'));
  }

  async #flag(path: string, known: DiskFile | null | undefined): Promise<void> {
    const disk = known === undefined ? await readDisk(this.store, path).catch(() => null) : known;
    const conflict = conflictOf(this.workspace.peek(), path, disk);
    if (this.#files.get(path)?.state !== 'conflict') return;
    this.conflicts.value = [...this.conflicts.peek().filter((c) => c.path !== path), conflict];
  }

  async #resolve(path: string, choice: ConflictChoice): Promise<void> {
    const rec = this.#files.get(path);
    if (rec?.state !== 'conflict') return;
    if (choice === 'keepMine') {
      this.#fire(path, 'keepMine');
      return;
    }
    // The copy is written before anything is taken from disk, so a copy that fails leaves the conflict open.
    if (choice === 'saveCopy') await this.#writeCopy(path);
    const disk = await readDisk(this.store, path);
    if (disk) this.#fire(path, choice, disk);
    else this.#fire(path, 'gone', null);
  }

  /** Save Mine as a Copy: `<name> copy <stamp>.ics`, shown as its own calendar (§3.5). */
  async #writeCopy(path: string): Promise<void> {
    const copy = copyOf(this.workspace.peek(), path, stamp(this.#now()));
    if (!copy) return;
    const version = await this.store.write(
      copy.id,
      encodeText(serializeDoc(copy.id, copy.document, this.#appVersion)),
      {
        create: true,
      },
    );
    const rec = this.#record(copy.id);
    rec.base = version;
    rec.disk = copy.document;
    this.workspace.value = withCalendar(this.workspace.peek(), copy);
    this.#publish();
  }

  // ——— Snapshots ———

  async #writeSnapshot(): Promise<void> {
    const files: SnapshotFile[] = [];
    for (const [path, rec] of this.#files) {
      const doc = rec.unsaved ? docOf(this.workspace.peek(), path) : null;
      if (doc) files.push({ path, base: rec.base, text: serializeDoc(path, doc, this.#appVersion) });
    }
    await this.#copies.save(files);
  }
}
