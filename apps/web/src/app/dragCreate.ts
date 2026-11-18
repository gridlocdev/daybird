/**
 * Creating by dragging (PRD §7.1): down the Day and Week grid for a timed event snapped to 15 minutes, across the
 * all-day strip or Month cells for an all-day one. A press without a drag selects nothing, a double-click makes
 * an event there, and Escape mid-drag cancels.
 */
import { useRef, useState } from 'preact/hooks';
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
import { newEventAt } from './eventActions.ts';

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

function capture(e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture?.(e.pointerId);
  el.focus({ preventScroll: true });
}

function movedFar(p: Press, e: PointerEvent): boolean {
  if (!p.moved) p.moved = Math.hypot(e.clientX - p.x, e.clientY - p.y) >= SLOP;
  return p.moved;
}

/** The timed drag in one day's column: the draft is minutes after midnight, the end past the last quarter. */
export function useTimeDrag(app: AppController, hourHeight: number) {
  const [draft, setDraft] = useState<{ day: PlainDate; from: number; to: number } | null>(null);
  const press = useRef<(Press & { day: PlainDate; at: number }) | null>(null);
  const minuteAt = (e: MouseEvent): number => {
    const top = (e.currentTarget as HTMLElement).getBoundingClientRect().top;
    const m = snapDown(((e.clientY - top) / hourHeight) * 60);
    return Math.max(0, Math.min(MINUTES_PER_DAY - SNAP_MINUTES, m));
  };
  const span = (at: number, m: number) => ({ from: Math.min(at, m), to: Math.max(at, m) + SNAP_MINUTES });
  const cancel = () => {
    press.current = null;
    setDraft(null);
  };
  return {
    draft,
    handlers: (day: PlainDate) => ({
      onPointerDown: (e: PointerEvent) => {
        if (!begins(e)) return;
        capture(e);
        press.current = { day, at: minuteAt(e), x: e.clientX, y: e.clientY, moved: false };
      },
      onPointerMove: (e: PointerEvent) => {
        const p = press.current;
        if (p && movedFar(p, e)) setDraft({ day: p.day, ...span(p.at, minuteAt(e)) });
      },
      onPointerUp: (e: PointerEvent) => {
        const p = press.current;
        cancel();
        if (!p) return;
        if (!p.moved) return app.select(null);
        const { from, to } = span(p.at, minuteAt(e));
        newEventAt(app, timedTimes(p.day, from, to, app.displayZone));
      },
      onPointerCancel: cancel,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !press.current) return;
        e.preventDefault();
        e.stopPropagation();
        cancel();
      },
      onDblClick: (e: MouseEvent) => {
        if (!onEmpty(e)) return;
        const m = minuteAt(e);
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
  const press = useRef<(Press & { day: PlainDate }) | null>(null);
  const span = (a: PlainDate, b: PlainDate) => (a <= b ? { first: a, last: b } : { first: b, last: a });
  const cancel = () => {
    press.current = null;
    setDraft(null);
  };
  return {
    draft,
    handlers: {
      onPointerDown: (e: PointerEvent) => {
        const day = begins(e) ? dayAt(e) : null;
        if (!day) return;
        capture(e);
        press.current = { day, x: e.clientX, y: e.clientY, moved: false };
      },
      onPointerMove: (e: PointerEvent) => {
        const p = press.current;
        if (p && movedFar(p, e)) setDraft(span(p.day, dayAt(e) ?? p.day));
      },
      onPointerUp: (e: PointerEvent) => {
        const p = press.current;
        cancel();
        if (!p) return;
        if (!p.moved) return app.select(null);
        const { first, last } = span(p.day, dayAt(e) ?? p.day);
        newEventAt(app, allDayTimes(first, last));
      },
      onPointerCancel: cancel,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !press.current) return;
        e.preventDefault();
        e.stopPropagation();
        cancel();
      },
      onDblClick: (e: MouseEvent) => {
        const day = onEmpty(e) ? dayAt(e) : null;
        if (day) newEventAt(app, allDayTimes(day, day));
      },
    },
  };
}
