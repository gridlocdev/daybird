/** What the desktop app's preload script puts on `window.daybirdNative` (PRD §14). */
import type { NativeMenuItem } from '@daybird/ui';

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
  /** The window entered or left full screen. */
  onFullScreen(fn: (full: boolean) => void): void;
}

export function nativeBridge(): DaybirdNative | null {
  return (globalThis as { daybirdNative?: DaybirdNative }).daybirdNative ?? null;
}
