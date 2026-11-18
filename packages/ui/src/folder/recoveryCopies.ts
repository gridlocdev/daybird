/**
 * The recovery snapshots of one folder (PRD §3.6): the ones closed windows left behind, and this window's own,
 * written every 30 s while anything is unsaved. A snapshot that can't be written or cleared is reported, never
 * dropped quietly.
 */
import type { Snapshot, SnapshotFile, SnapshotStorage } from './snapshots.ts';

export class RecoveryCopies {
  readonly #storage: SnapshotStorage;
  readonly #folder: string;
  readonly #now: () => number;
  readonly #fail: (text: string) => void;
  #orphans: Snapshot[] = [];

  constructor(storage: SnapshotStorage, folder: string, now: () => number, fail: (text: string) => void) {
    this.#storage = storage;
    this.#folder = folder;
    this.#now = now;
    this.#fail = fail;
  }

  /** Reads what closed windows left. Must come before anything in the folder is written. */
  async load(): Promise<void> {
    this.#orphans = await this.#storage.orphans(this.#folder);
  }

  /** Each file's newest copy across the snapshots closed windows left. */
  latestFiles(): Map<string, SnapshotFile> {
    const out = new Map<string, SnapshotFile>();
    for (const s of [...this.#orphans].sort((a, b) => a.savedAt - b.savedAt))
      for (const f of s.files) out.set(f.path, f);
    return out;
  }

  /** When the newest of them was taken; 0 when there are none. */
  savedAt(): number {
    return Math.max(0, ...this.#orphans.map((s) => s.savedAt));
  }

  /** The user answered the recovery dialog, or there was nothing to offer: the left snapshots go. */
  async dropOrphans(): Promise<void> {
    const ids = this.#orphans.map((s) => s.windowId).filter((id) => id !== this.#storage.windowId);
    this.#orphans = [];
    for (const id of ids)
      await this.#storage.remove(id).catch((e: unknown) => {
        this.#fail(`Couldn’t clear an old recovery copy: ${message(e)}`);
      });
  }

  /** Keeps this window's unsaved files; none clears its snapshot. */
  async save(files: readonly SnapshotFile[]): Promise<void> {
    const windowId = this.#storage.windowId;
    try {
      if (!files.length) await this.#storage.remove(windowId);
      else await this.#storage.save({ windowId, folder: this.#folder, savedAt: this.#now(), files });
    } catch (e) {
      this.#fail(`Couldn’t keep a recovery copy of unsaved changes: ${message(e)}`);
    }
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
