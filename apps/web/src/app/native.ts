/** What the desktop app's preload script puts on `window.daybirdNative` (PRD §14). */
import type { NativeFiles, NativeMenuItem } from '@daybird/ui';

/** The calendar folder the desktop app has open. `missing`: the one chosen last time is gone. */
export interface NativeFolder {
  readonly path: string;
  readonly name: string;
  readonly missing: boolean;
}

export interface DaybirdNative {
  readonly version: string;
  /** 'unified': the window has no title bar and the page draws the toolbar row in its place (macOS). */
  readonly chrome: 'unified' | 'native';
  /** Replaces the menu bar. */
  setMenu(items: readonly NativeMenuItem[]): void;
  /** A menu bar item was chosen. */
  onCommand(fn: (id: string) => void): void;
  /** The window wants to close: finish saving, then call `closeReady`. */
  onCloseRequested(fn: () => void): void;
  closeReady(): void;
  /** The open calendar folder's files (PRD §3.7). */
  readonly files: NativeFiles;
  readonly folder: {
    /** The folder open now, the missing one, or null on first start. */
    current(): Promise<NativeFolder | null>;
    /** Asks for a folder; null when the user cancelled. */
    choose(): Promise<NativeFolder | null>;
    /** Opens Documents/Daybird, making it. */
    useDefault(): Promise<NativeFolder | null>;
  };
  /** The window entered or left full screen. */
  onFullScreen(fn: (full: boolean) => void): void;
  /** Shows a reminder as a system notification (PRD §9). */
  notify(notification: { readonly id: string; readonly title: string; readonly body: string }): void;
  /** A notification was clicked: its id. */
  onNotificationClick(fn: (id: string) => void): void;
  /** `.ics` files were opened from the Finder or the command line: take them with `takeOpenedFiles`. */
  onFilesOpened(fn: () => void): void;
  /** The opened files waiting, each read once; the main process forgets them. */
  takeOpenedFiles(): Promise<readonly OpenedFile[]>;
}

/** An `.ics` file opened from outside the app (PRD §14), or why it couldn't be read. */
export type OpenedFile =
  | { readonly ok: true; readonly name: string; readonly text: string }
  | { readonly ok: false; readonly name: string; readonly message: string };

export function nativeBridge(): DaybirdNative | null {
  return (globalThis as { daybirdNative?: DaybirdNative }).daybirdNative ?? null;
}
