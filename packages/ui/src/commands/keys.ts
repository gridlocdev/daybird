/** The page's one keyboard listener: every key goes through the command catalog (PRD §12). */
import type { CommandCatalog, KeyFocus } from './command.ts';

/** Where keyboard focus is, for deciding which keys are commands. */
export function keyFocus(el: Element | null): KeyFocus {
  if (!el || el === el.ownerDocument?.body) return 'list';
  if (el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return 'text';
  if (el.closest('button, a, [role=button], [role=menuitem], [role=option]')) return 'control';
  return 'list';
}

/**
 * Sends key presses on `target` to the catalog. `blocked` is true while a dialog is open; then only commands
 * the catalog's gate lets through (those that toggle their own window) run. Returns a function that stops
 * listening.
 */
export function listenForKeys(target: Window, catalog: CommandCatalog, blocked: () => boolean): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const result = catalog.forEvent(e, keyFocus(target.document.activeElement));
    if (!result) return;
    if (result.kind === 'wait') {
      e.preventDefault();
      return;
    }
    if (blocked() && !catalog.gate?.(result.command)) return;
    e.preventDefault();
    catalog.run(result.command.id);
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}

/** The part of a window or element `captureKeys` needs, so it can be tested without a page. */
export interface KeyTarget {
  addEventListener(type: 'keydown', listener: (e: KeyboardEvent) => void, options: { capture: true }): void;
  removeEventListener(
    type: 'keydown',
    listener: (e: KeyboardEvent) => void,
    options: { capture: true },
  ): void;
}

/**
 * Takes every key press on `target` before anything else sees it and hands it to `onKey` (the Keyboard
 * Shortcuts window's finder). Escape is never taken: it goes on as usual, so the window can always leave
 * the mode. If `onKey` throws, the capture stops for good and `onEnd` runs, so an error can't leave every
 * key swallowed. Returns a function that stops it; calling it again does nothing.
 */
export function captureKeys(
  target: KeyTarget,
  onKey: (e: KeyboardEvent) => void,
  onEnd: () => void,
): () => void {
  let on = true;
  const stop = () => {
    if (!on) return;
    on = false;
    target.removeEventListener('keydown', listener, { capture: true });
  };
  const listener = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    let handled = false;
    try {
      onKey(e);
      handled = true;
    } finally {
      if (!handled) {
        stop();
        onEnd();
      }
    }
  };
  target.addEventListener('keydown', listener, { capture: true });
  return stop;
}
