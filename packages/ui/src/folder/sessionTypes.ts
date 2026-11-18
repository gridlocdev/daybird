/** The folder session's public types and constants, and the per-file record it keeps (PRD §3). */
import type { ComponentNode } from '@daybird/core';
import type { CalendarStore } from '../platform/calendarStore.ts';
import type { SaveState } from './saveChart.ts';
import type { SnapshotStorage } from './snapshots.ts';

export const TRASH_PATH = '.daybird/trash.ics';
/** The waits before the two retries of a failed save (§3.4). */
export const RETRY_DELAYS: readonly number[] = [300, 600];
/** How often unsaved changes go to the recovery snapshot (§3.6). */
export const SNAPSHOT_MS = 30_000;

export interface SessionNotice {
  readonly tone?: 'error';
  readonly action?: { readonly label: string; readonly run: () => void };
}

export interface SessionOptions {
  readonly store: CalendarStore;
  readonly snapshots: SnapshotStorage;
  /** Shows a notice in the status bar. */
  readonly say: (text: string, options?: SessionNotice) => void;
  /** Written into PRODID (§3.3). */
  readonly appVersion: string;
  /** Milliseconds since the epoch. */
  readonly now?: () => number;
  readonly makeUid?: () => string;
  readonly displayZone?: string;
}

/** A file that changed or went on disk under unsaved changes (§3.5). */
export interface Conflict {
  readonly path: string;
  readonly name: string;
  readonly reason: 'changed' | 'deleted';
  /** Events that differ between the window's version and the disk's. */
  readonly differs: number;
}

export type ConflictChoice = 'saveCopy' | 'keepMine' | 'useTheirs';

/** Unsaved changes a closed window left behind (§3.6). */
export interface RecoveryOffer {
  readonly files: readonly { readonly path: string; readonly name: string }[];
  /** Milliseconds since the epoch. */
  readonly savedAt: number;
}

export interface FileRecord {
  state: SaveState;
  /** The version last read or written; null while the file isn't on disk yet. */
  base: string | null;
  /** The document as last read or written. */
  disk: ComponentNode | null;
  /** Failed writes in a row. */
  attempts: number;
  cancelRetry: (() => void) | null;
  /** The next write overwrites whatever is on disk: the user chose Keep Mine. */
  force: boolean;
  /** Writes that landed: a refresh that saw one land during its read skips the file. */
  writes: number;
  reported: boolean;
  /** In the recovery snapshot. */
  unsaved: boolean;
}

export interface DiskFile {
  readonly version: string;
  readonly text: string;
}

export const isCalendarFile = (name: string): boolean => /\.ics$/i.test(name) && !name.startsWith('.');

export function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function newRecord(): FileRecord {
  return {
    state: 'clean',
    base: null,
    disk: null,
    attempts: 0,
    cancelRetry: null,
    force: false,
    writes: 0,
    reported: false,
    unsaved: false,
  };
}
