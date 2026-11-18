/**
 * The rules for saving one file of the calendar folder, as a table (PRD §3.4, §3.5). `FolderSession` keeps each
 * file's state and its bookkeeping (the version it last read or wrote, the retry timer, whether it has a recovery
 * copy); this table says which moves those may make. `docs/architecture.md` draws it, and a test checks the
 * drawing matches.
 *
 * Every change saves at once, so there is no "dirty but waiting" state. Work that has to finish before an event
 * can fire happens first: Save Mine as a Copy writes the copy before `saveCopy`, and Use Theirs reads the file
 * before `useTheirs`, so a copy that fails to write leaves the conflict open and nothing is lost.
 */

export type SaveState =
  /** The file on disk has the window's version. */
  | 'clean'
  /** Writing the file; nothing changed since the write started. */
  | 'saving'
  /** Writing the file; it changed since, so another write follows when this one lands. */
  | 'savingDirty'
  /** A write failed and another try waits (300 ms, then 600 ms). */
  | 'retrying'
  /** Three writes failed: "Couldn't save <calendar>." with Try again, until a write works. */
  | 'failed'
  /** The file changed or went on disk under unsaved changes; nothing is written until the user chooses. */
  | 'conflict'
  /** The file went from the folder, so its calendar went too (the trash starts again empty). */
  | 'removed';

export type SaveEvent =
  /** The window changed the file's calendar (an edit, an undo, a restored snapshot). */
  | 'edit'
  | 'saved'
  /** A write failed and a retry is left. */
  | 'failed'
  /** A write failed with no retry left. */
  | 'failedFinal'
  /** The retry delay passed. */
  | 'retryTimer'
  /** The write found the file changed or gone on disk. */
  | 'versionChanged'
  /** A refresh read a different version from disk. */
  | 'outsideChange'
  /** A refresh found the file gone. */
  | 'outsideDelete'
  /** Try again, in the status bar. */
  | 'tryAgain'
  /** Save Mine as a Copy: the copy is written; take the file on disk. */
  | 'saveCopy'
  /** Keep Mine: write over the disk's version. */
  | 'keepMine'
  /** Use Theirs: take the file on disk (read just before). */
  | 'useTheirs'
  /** Use Theirs found the file gone, so the calendar went with it. */
  | 'gone';

export type Effect =
  /** Write the file, checking the disk still has the version last read or written. */
  | 'writeFile'
  /** Write the file whatever the disk has: the user chose it. Later writes check versions again. */
  | 'overwriteFile'
  /** The file has unsaved changes: keep it in the recovery snapshot (§3.6). */
  | 'keepCopy'
  /** The disk has every change, or the user threw them away: drop it from the snapshot. */
  | 'dropCopy'
  | 'scheduleRetry'
  | 'cancelRetry'
  /** "Couldn't save <calendar>." with Try again. */
  | 'report'
  /** "Saved.", when a failure was reported. */
  | 'clearReport'
  /** Take the file from disk as one undo step with a notice, or drop the calendar when the file went. */
  | 'takeFile'
  /** Take the file from disk over the window's changes: the user chose it. Undo steps can't come back over it. */
  | 'replaceWithFile'
  /** Open the conflict dialog for the file. */
  | 'flag'
  | 'unflag';

export interface Transition {
  readonly from: SaveState;
  readonly on: SaveEvent;
  readonly to: SaveState;
  readonly effects: readonly Effect[];
}

/** Every allowed move. An event with no row for the state it arrives in changes nothing. */
export const SAVE_TRANSITIONS: readonly Transition[] = [
  { from: 'clean', on: 'edit', to: 'saving', effects: ['keepCopy', 'writeFile'] },
  { from: 'clean', on: 'outsideChange', to: 'clean', effects: ['takeFile'] },
  { from: 'clean', on: 'outsideDelete', to: 'removed', effects: ['takeFile'] },

  // A refresh skips a file whose write is in flight: the write's answer says what is on disk.
  { from: 'saving', on: 'edit', to: 'savingDirty', effects: ['keepCopy'] },
  { from: 'saving', on: 'saved', to: 'clean', effects: ['dropCopy', 'clearReport'] },
  { from: 'saving', on: 'failed', to: 'retrying', effects: ['scheduleRetry'] },
  { from: 'saving', on: 'failedFinal', to: 'failed', effects: ['report'] },
  { from: 'saving', on: 'versionChanged', to: 'conflict', effects: ['flag'] },

  { from: 'savingDirty', on: 'edit', to: 'savingDirty', effects: ['keepCopy'] },
  { from: 'savingDirty', on: 'saved', to: 'saving', effects: ['writeFile'] },
  { from: 'savingDirty', on: 'failed', to: 'retrying', effects: ['scheduleRetry'] },
  { from: 'savingDirty', on: 'failedFinal', to: 'failed', effects: ['report'] },
  { from: 'savingDirty', on: 'versionChanged', to: 'conflict', effects: ['flag'] },

  // The retry writes whatever the window has by then, edits made while waiting included.
  { from: 'retrying', on: 'edit', to: 'retrying', effects: ['keepCopy'] },
  { from: 'retrying', on: 'retryTimer', to: 'saving', effects: ['writeFile'] },
  { from: 'retrying', on: 'outsideChange', to: 'conflict', effects: ['cancelRetry', 'flag'] },
  { from: 'retrying', on: 'outsideDelete', to: 'conflict', effects: ['cancelRetry', 'flag'] },

  { from: 'failed', on: 'edit', to: 'saving', effects: ['keepCopy', 'writeFile'] },
  { from: 'failed', on: 'tryAgain', to: 'saving', effects: ['writeFile'] },
  { from: 'failed', on: 'outsideChange', to: 'conflict', effects: ['flag'] },
  { from: 'failed', on: 'outsideDelete', to: 'conflict', effects: ['flag'] },

  { from: 'conflict', on: 'edit', to: 'conflict', effects: ['keepCopy'] },
  { from: 'conflict', on: 'saveCopy', to: 'clean', effects: ['replaceWithFile', 'unflag', 'dropCopy'] },
  { from: 'conflict', on: 'keepMine', to: 'saving', effects: ['unflag', 'overwriteFile'] },
  { from: 'conflict', on: 'useTheirs', to: 'clean', effects: ['replaceWithFile', 'unflag', 'dropCopy'] },
  { from: 'conflict', on: 'gone', to: 'removed', effects: ['replaceWithFile', 'unflag', 'dropCopy'] },

  // Only the trash can change once its file went: a deletion writes a new one.
  { from: 'removed', on: 'edit', to: 'saving', effects: ['keepCopy', 'writeFile'] },
];

const NONE: readonly Effect[] = [];

/** Where `event` takes `state`, and what to do on the way. */
export function step(state: SaveState, event: SaveEvent): { to: SaveState; effects: readonly Effect[] } {
  const row = SAVE_TRANSITIONS.find((t) => t.from === state && t.on === event);
  return row ? { to: row.to, effects: row.effects } : { to: state, effects: NONE };
}

/** The table as a Mermaid state diagram, for `docs/architecture.md`. */
export function toMermaid(): string {
  const lines = ['stateDiagram-v2', '  [*] --> clean'];
  for (const t of SAVE_TRANSITIONS) {
    const effects = t.effects.length ? ` / ${t.effects.join(', ')}` : '';
    lines.push(`  ${t.from} --> ${t.to} : ${t.on}${effects}`);
  }
  return lines.join('\n');
}

/** States where the window has changes the disk doesn't. */
export function hasUnsaved(state: SaveState): boolean {
  return state !== 'clean' && state !== 'removed';
}
