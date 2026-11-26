/**
 * Roving focus: a grid or a group of choices has one tab stop, the item the app's state picks (the shown date, the
 * chosen colour). An arrow key changes the state, the tab stop follows the state when it is drawn again, and
 * keyboard focus follows the tab stop. Nothing here keeps its own idea of which item is current.
 *
 * The scope is the nearest element with `data-roving`; its items take `tabIndex={current ? 0 : -1}` and
 * `ref={current ? takeStop : undefined}`.
 */

/** The scope whose keys just moved its tab stop: the stop drawn next in it takes focus, even if the old one is gone. */
let moving: Element | null = null;

const scopeOf = (el: Element): Element | null => el.closest('[data-roving]');

/** Runs `change` for a key pressed on `from`, so that the new tab stop takes focus once it is drawn. */
export function moveStop(from: Element, change: () => void): void {
  moving = scopeOf(from);
  change();
}

/**
 * The ref for a scope's tab stop. It takes focus only when its own scope's keys moved it, and focus is still in the
 * scope or was lost with the old stop: a redraw for any other reason leaves focus where the user put it.
 */
export function takeStop(el: HTMLElement | null): void {
  if (!el || moving === null || scopeOf(el) !== moving) return;
  const active = el.ownerDocument.activeElement;
  moving = null;
  if (!active || active === el.ownerDocument.body || el.closest('[data-roving]')?.contains(active))
    el.focus();
}

/** The choice an arrow key, Home or End picks in a row of `count` choices (wrapping), or null for another key. */
export function rovingStep(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Key handling for a radio group drawn from state: an arrow, Home or End picks the next choice with `pick`, and focus
 * follows it. Returns true when it used the key.
 */
export function radioKeys<T>(
  e: KeyboardEvent,
  choices: readonly T[],
  current: T,
  pick: (choice: T) => void,
): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  const next = rovingStep(e.key, Math.max(0, choices.indexOf(current)), choices.length);
  if (next === null) return false;
  e.preventDefault();
  e.stopPropagation();
  moveStop(e.currentTarget as Element, () => pick(choices[next]!));
  return true;
}
