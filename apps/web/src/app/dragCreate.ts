/**
 * Creating by dragging (PRD §7.1): down the Day and Week grid for a timed event snapped to 15 minutes, across the
 * all-day strip or Month cells for an all-day one. A press without a drag selects nothing, a double-click makes
 * an event there, and Escape mid-drag cancels.
 */
import { useState } from 'preact/hooks';
import {
  MINUTES_PER_DAY,
  SNAP_MINUTES,
  addDays,
  allDayTimes,
  snapDown,
  timedTimes,
  type PlainDate,
} from '@daybird/core';
import type { AppController } from './controller.ts';
import type { MoveTarget } from '@daybird/core';
import { newEventAt } from './eventActions.ts';
import { cancelPress, trackPress } from './pointerTrack.ts';

/** How far the pointer moves before a press counts as a drag, in px. */
const SLOP = 4;

interface Press {
  readonly x: number;
  readonly y: number;
  moved: boolean;
}

/** A press on empty space: not on an event, a day number or another control. */
const onEmpty = (e: Event): boolean => !(e.target as Element).closest('button, a, input, select, textarea');
const begins = (e: PointerEvent): boolean => e.button === 0 && onEmpty(e);

/** Takes the pointer and the keyboard (for Escape) to the pressed element, and returns it. */
function capture(e: PointerEvent): HTMLElement {
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture?.(e.pointerId);
  el.focus({ preventScroll: true });
  return el;
}

/** Lets go of the keyboard at the end of a press: an empty column has no focus to show, and a new event takes it. */
function release(el: HTMLElement): void {
  if (el.ownerDocument.activeElement === el) el.blur();
}

function cancelOnEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !cancelPress()) return;
  e.preventDefault();
  e.stopPropagation();
}

function movedFar(p: Press, e: PointerEvent): boolean {
  if (!p.moved) p.moved = Math.hypot(e.clientX - p.x, e.clientY - p.y) >= SLOP;
  return p.moved;
}

/** The timed drag in one day's column: the draft is minutes after midnight, the end past the last quarter. */
export function useTimeDrag(app: AppController, hourHeight: number) {
  const [draft, setDraft] = useState<{ day: PlainDate; from: number; to: number } | null>(null);
  const minuteAt = (column: HTMLElement, e: MouseEvent): number => {
    const m = snapDown(((e.clientY - column.getBoundingClientRect().top) / hourHeight) * 60);
    return Math.max(0, Math.min(MINUTES_PER_DAY - SNAP_MINUTES, m));
  };
  const span = (at: number, m: number) => ({ from: Math.min(at, m), to: Math.max(at, m) + SNAP_MINUTES });
  return {
    draft,
    handlers: (day: PlainDate) => ({
      onPointerDown: (e: PointerEvent) => {
        if (!begins(e)) return;
        const column = capture(e);
        const at = minuteAt(column, e);
        const p: Press = { x: e.clientX, y: e.clientY, moved: false };
        trackPress(e, {
          move: (m) => {
            if (movedFar(p, m)) setDraft({ day, ...span(at, minuteAt(column, m)) });
          },
          up: (u) => {
            setDraft(null);
            release(column);
            if (!p.moved) return app.select(null);
            const { from, to } = span(at, minuteAt(column, u));
            newEventAt(app, timedTimes(day, from, to, app.displayZone));
          },
          cancel: () => {
            setDraft(null);
            release(column);
          },
        });
      },
      onKeyDown: cancelOnEscape,
      onDblClick: (e: MouseEvent) => {
        if (!onEmpty(e)) return;
        const m = minuteAt(e.currentTarget as HTMLElement, e);
        newEventAt(app, timedTimes(day, m, m + app.settings.peek().eventMinutes, app.displayZone));
      },
    }),
  };
}

/**
 * The day under the pointer, in a row of days marked `data-week` (its first day) and `data-days` (how many),
 * whatever is drawn over it.
 */
export function dateAtPoint(e: MouseEvent): PlainDate | null {
  const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-week]');
  const first = row?.dataset.week as PlainDate | undefined;
  if (!row || !first) return null;
  const days = Number(row.dataset.days ?? 7);
  const r = row.getBoundingClientRect();
  const i = Math.max(0, Math.min(days - 1, Math.floor(((e.clientX - r.left) / r.width) * days)));
  return addDays(first, i);
}

/** The all-day drag across days; `dayAt` says which day the pointer is over. */
export function useDayDrag(app: AppController, dayAt: (e: MouseEvent) => PlainDate | null) {
  const [draft, setDraft] = useState<{ first: PlainDate; last: PlainDate } | null>(null);
  const span = (a: PlainDate, b: PlainDate) => (a <= b ? { first: a, last: b } : { first: b, last: a });
  return {
    draft,
    handlers: {
      onPointerDown: (e: PointerEvent) => {
        const day = begins(e) ? dayAt(e) : null;
        if (!day) return;
        const row = capture(e);
        const p: Press = { x: e.clientX, y: e.clientY, moved: false };
        trackPress(e, {
          move: (m) => {
            if (movedFar(p, m)) setDraft(span(day, dayAt(m) ?? day));
          },
          up: (u) => {
            setDraft(null);
            release(row);
            if (!p.moved) return app.select(null);
            const { first, last } = span(day, dayAt(u) ?? day);
            newEventAt(app, allDayTimes(first, last));
          },
          cancel: () => {
            setDraft(null);
            release(row);
          },
        });
      },
      onKeyDown: cancelOnEscape,
      onDblClick: (e: MouseEvent) => {
        const day = onEmpty(e) ? dayAt(e) : null;
        if (day) newEventAt(app, allDayTimes(day, day));
      },
    },
  };
}

/** The quarter hour under the pointer in a day's column. */
export function timeTarget(e: MouseEvent, date: PlainDate): MoveTarget {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const m = snapDown(((e.clientY - r.top) / (r.height / 24)) * 60);
  return { kind: 'time', date, minute: Math.max(0, Math.min(MINUTES_PER_DAY - SNAP_MINUTES, m)) };
}

/** The day under the pointer in the all-day strip or a Month week. */
export function dayTarget(e: MouseEvent): MoveTarget | null {
  const date = dateAtPoint(e);
  return date ? { kind: 'day', date } : null;
}

/** The right-click menu on empty grid: New Event Here and Paste, at that place (§12). */
export function emptyMenu(app: AppController, e: MouseEvent, target: () => MoveTarget | null): void {
  if (!onEmpty(e)) return;
  e.preventDefault();
  const t = target();
  if (t) app.eventMenu.value = { x: e.clientX, y: e.clientY, onEvent: false, target: t };
}
