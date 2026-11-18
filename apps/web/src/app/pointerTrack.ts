/**
 * Follows one press to its end through the window, not the pressed element: an event re-drawn mid-drag (a new
 * event saved, its popover closed) takes its pointer capture with it, and the release would otherwise go to
 * whatever is under the pointer and leave the drag stuck on it. One press at a time; a new one ends the last.
 */

export interface Tracked {
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  /** The press ended without a drop: Escape, a cancelled pointer, the window losing focus, a new press. */
  cancel(): void;
}

let current: { cancel(): void } | null = null;

/** Starts following the press `down` began; pointer moves and the release reach `t` wherever they happen. */
export function trackPress(down: PointerEvent, t: Tracked): void {
  current?.cancel();
  const id = down.pointerId;
  const move = (e: PointerEvent) => {
    if (e.pointerId === id) t.move(e);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    stop();
    t.up(e);
  };
  const cancelled = (e: PointerEvent) => {
    if (e.pointerId === id) cancel();
  };
  const cancel = () => {
    stop();
    t.cancel();
  };
  const stop = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', cancelled);
    removeEventListener('blur', cancel);
    if (current === mine) current = null;
  };
  const mine = { cancel };
  current = mine;
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', cancelled);
  addEventListener('blur', cancel);
}

/** Ends the press being followed as cancelled (Escape on the pressed element). True if there was one. */
export function cancelPress(): boolean {
  if (!current) return false;
  current.cancel();
  return true;
}
