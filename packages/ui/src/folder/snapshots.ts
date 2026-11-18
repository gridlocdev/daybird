/**
 * Recovery snapshots (PRD §3.6): every 30 s while anything is unsaved, and on closing, each window writes its
 * unsaved files to storage outside the folder. One snapshot per window, so two windows never overwrite each
 * other's. On start, the snapshots of windows that are gone are offered back.
 */

export interface SnapshotFile {
  readonly path: string;
  /** The version the window last read or wrote; a restore saves against it, so a newer file is a conflict. */
  readonly base: string | null;
  readonly text: string;
}

export interface Snapshot {
  readonly windowId: string;
  /** Which folder: the store's kind and name. */
  readonly folder: string;
  /** Milliseconds since the epoch. */
  readonly savedAt: number;
  readonly files: readonly SnapshotFile[];
}

export interface SnapshotStorage {
  /** This window's id. */
  readonly windowId: string;
  /** The snapshots of `folder` left by windows that are no longer open (this window's earlier run included). */
  orphans(folder: string): Promise<Snapshot[]>;
  /** Writes this window's snapshot, replacing the last. Throws when storage refuses it. */
  save(snapshot: Snapshot): Promise<void>;
  /** Removes a window's snapshot. */
  remove(windowId: string): Promise<void>;
}

/** Snapshots in memory, for tests. `live` holds the ids of windows that are still open. */
export function memorySnapshots(
  windowId: string,
  shared = new Map<string, Snapshot>(),
  live = new Set<string>(),
) {
  live.add(windowId);
  const storage: SnapshotStorage & { readonly all: Map<string, Snapshot>; failing: boolean } = {
    windowId,
    all: shared,
    failing: false,
    orphans: (folder) =>
      Promise.resolve(
        [...shared.values()].filter(
          (s) => s.folder === folder && (s.windowId === windowId || !live.has(s.windowId)),
        ),
      ),
    save: (snapshot) => {
      if (storage.failing) return Promise.reject(new Error('Storage is full.'));
      shared.set(snapshot.windowId, snapshot);
      return Promise.resolve();
    },
    remove: (id) => {
      shared.delete(id);
      return Promise.resolve();
    },
  };
  return storage;
}

/** Reads a stored snapshot, or null when it isn't one. */
export function parseSnapshot(text: string): Snapshot | null {
  try {
    const v = JSON.parse(text) as Partial<Snapshot>;
    if (typeof v.windowId !== 'string' || typeof v.folder !== 'string' || typeof v.savedAt !== 'number')
      return null;
    if (!Array.isArray(v.files)) return null;
    const files = v.files.filter(
      (f): f is SnapshotFile =>
        typeof f === 'object' &&
        f !== null &&
        typeof f.path === 'string' &&
        typeof f.text === 'string' &&
        (f.base === null || typeof f.base === 'string'),
    );
    return { windowId: v.windowId, folder: v.folder, savedAt: v.savedAt, files };
  } catch {
    return null;
  }
}
