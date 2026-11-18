import { parseSnapshot, type Snapshot, type SnapshotStorage } from '../folder/snapshots.ts';

const PREFIX = 'daybird:snapshot:';
const WINDOW_KEY = 'daybird:window';
const LOCK_PREFIX = 'daybird-window:';

function randomId(): string {
  return crypto.randomUUID();
}

/**
 * Snapshots in the browser's local storage. Each window keeps its id in session storage (so a reload is the same
 * window) and holds a Web Lock named after it while open; a snapshot whose window's lock is free was left by a
 * window that closed or crashed.
 */
export function localSnapshots(): SnapshotStorage {
  let windowId = sessionStorage.getItem(WINDOW_KEY);
  if (!windowId) {
    windowId = randomId();
    sessionStorage.setItem(WINDOW_KEY, windowId);
  }
  const id = windowId;
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  void locks?.request(`${LOCK_PREFIX}${id}`, () => new Promise<void>(() => undefined));

  return {
    windowId: id,
    async orphans(folder) {
      const held = new Set(
        ((await locks?.query())?.held ?? []).map((l) => l.name?.slice(LOCK_PREFIX.length) ?? ''),
      );
      const out: Snapshot[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(PREFIX)) continue;
        const s = parseSnapshot(localStorage.getItem(key) ?? '');
        if (s && s.folder === folder && (s.windowId === id || !held.has(s.windowId))) out.push(s);
      }
      return out;
    },
    async save(snapshot) {
      localStorage.setItem(`${PREFIX}${snapshot.windowId}`, JSON.stringify(snapshot));
    },
    async remove(windowId) {
      localStorage.removeItem(`${PREFIX}${windowId}`);
    },
  };
}
