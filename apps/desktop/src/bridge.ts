/**
 * The channels between the main process and the preload. The sandboxed preload can't import this file,
 * so it repeats the names: keep the two in step.
 */
export const Channels = {
  setMenu: 'daybird:set-menu',
  closeReady: 'daybird:close-ready',
  command: 'daybird:command',
  closeRequested: 'daybird:close-requested',
  fullScreen: 'daybird:full-screen',
} as const;

/** One item of the menu bar the page sends, as `NativeMenuItem` in @daybird/ui. */
export interface NativeMenuItem {
  readonly type?: 'separator' | 'checkbox';
  readonly role?: string;
  readonly label?: string;
  readonly command?: string;
  readonly accelerator?: string;
  readonly enabled?: boolean;
  readonly checked?: boolean;
  readonly submenu?: readonly NativeMenuItem[];
}
