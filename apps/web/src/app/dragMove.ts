/**
 * Dragging an event (PRD §7.3): move it in the time grid (15-minute snap, across days, into or out of the
 * all-day strip), by days in Month, drag its bottom edge to change the end, Shift-drag its top edge to change the
 * start, Option-drag to copy. A ghost shows where it would land; Escape cancels. The press is followed through the window, so a release always ends it. One drag at a time.
 */
import {
  MINUTES_PER_DAY,
  SNAP_MINUTES,
  addDays,
  diffDays,
  inDisplayZone,
  movedTimes,
  shiftedTimes,
  snapDown,
  whenOf,
  withEndAt,
  withStartAt,
  type Occurrence,
  type PlainDate,
  type TimeValue,
} from '@daybird/core';
import type { AppController, DragGhost } from './controller.ts';
import { dateAtPoint } from './dragCreate.ts';
import { canChange, detailsOf, dropEvent } from './moveActions.ts';
import { cancelPress, trackPress } from './pointerTrack.ts';

type Times = { start: TimeValue; end: TimeValue };
type Mode = 'move' | 'end' | 'start';

/** How far the pointer moves before a press counts as a drag, in px; and how near an edge resizes. */
const SLOP = 4;
const EDGE = 6;

interface Press {
  readonly x: number;
  readonly y: number;
  readonly mode: Mode;
  readonly times: Times;
  /** Minutes from the event's start to the pointer, or days from its first day, so it moves by where it's held. */
  readonly grabMinutes: number;
  readonly grabDays: number;
  readonly title: string;
  readonly colour: string;
  moved: boolean;
  target: Times | null;
}

/** When the last drag ended: the click that follows it must not select or open the event. */
let droppedAt = -Infinity;

/** True once, just after a drag, so the click it causes is ignored. */
export function justDragged(): boolean {
  const recent = performance.now() - droppedAt < 400;
  droppedAt = -Infinity;
  return recent;
}

const clampStart = (m: number) => Math.max(0, Math.min(MINUTES_PER_DAY - SNAP_MINUTES, m));

function modeAt(e: PointerEvent, el: HTMLElement, allDay: boolean): Mode {
  if (allDay || !el.classList.contains('db-event')) return 'move';
  const r = el.getBoundingClientRect();
  if (r.bottom - e.clientY <= EDGE) return 'end';
  if (e.shiftKey && e.clientY - r.top <= EDGE) return 'start';
  return 'move';
}

/** Where the pointer would put the event, and the ghost to draw there. */
function landing(app: AppController, p: Press, e: PointerEvent): { times: Times; ghost: DragGhost } | null {
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const zone = app.displayZone;
  const column = under?.closest<HTMLElement>('.db-column[data-date]');
  if (column) {
    const r = column.getBoundingClientRect();
    const hour = r.height / 24;
    const date = column.dataset.date as PlainDate;
    const exact = ((e.clientY - r.top) / hour) * 60;
    const m = snapDown(exact);
    const times =
      p.mode === 'end'
        ? withEndAt(p.times, date, Math.round(exact / SNAP_MINUTES) * SNAP_MINUTES, zone)
        : p.mode === 'start'
          ? withStartAt(p.times, date, m)
          : movedTimes(
              p.times,
              { kind: 'time', date, minute: clampStart(m - p.grabMinutes) },
              zone,
              app.settings.peek().eventMinutes,
            );
    const w = whenOf(times.start, times.end);
    const top = w.startDate === date ? w.startMinute : 0;
    const bottom = w.endDate === date ? w.endMinute : MINUTES_PER_DAY;
    return {
      times,
      ghost: {
        left: r.left,
        width: r.width - 4,
        top: r.top + (top / 60) * hour,
        height: Math.max(SNAP_MINUTES, bottom - top) * (hour / 60),
        label: p.title,
        colour: p.colour,
      },
    };
  }
  const row = under?.closest<HTMLElement>('[data-week]');
  const day = p.mode === 'move' && row ? dateAtPoint(e) : null;
  if (!row || !day) return null;
  const first = addDays(day, -p.grabDays);
  const allDayRow = row.dataset.allDay !== undefined;
  const times =
    allDayRow || p.times.start.kind === 'date'
      ? movedTimes(p.times, { kind: 'day', date: first }, zone, app.settings.peek().eventMinutes)
      : shiftedTimes(p.times, { days: diffDays(whenOf(p.times.start, p.times.end).startDate, first) });
  const w = whenOf(times.start, times.end);
  const week = row.dataset.week as PlainDate;
  const days = Number(row.dataset.days ?? 7);
  const r = row.getBoundingClientRect();
  const from = Math.max(0, diffDays(week, w.startDate));
  const to = Math.min(days - 1, diffDays(week, w.allDay ? w.endDate : w.startDate));
  return {
    times,
    ghost: {
      left: r.left + (from / days) * r.width,
      width: (Math.max(1, to - from + 1) / days) * r.width - 4,
      top: r.top + (allDayRow ? 3 : 24),
      height: 20,
      label: p.title,
      colour: p.colour,
    },
  };
}

/** The pointer and key handlers that let an event be dragged, for every view that draws one. */
export function dragHandlers(app: AppController, o: Occurrence, colour: string) {
  const ref = { calendarId: o.calendarId, uid: o.uid, key: o.key };
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0 || !canChange(app, ref)) return;
      const d = detailsOf(app, ref);
      if (!d) return;
      const el = e.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      const hour = (el.closest('.db-column')?.getBoundingClientRect().height ?? 24 * 48) / 24;
      const day = o.allDay ? dateAtPoint(e) : null;
      el.setPointerCapture?.(e.pointerId);
      const p: Press = {
        x: e.clientX,
        y: e.clientY,
        mode: modeAt(e, el, o.allDay),
        // The grid is in the display zone, so the drag is too; the drop goes back to the event's own clock.
        times: inDisplayZone({ start: d.start, end: d.end }, d.zones, app.displayZone),
        grabMinutes: snapDown(((e.clientY - r.top) / hour) * 60),
        grabDays: day && o.startDate ? Math.max(0, diffDays(o.startDate, day)) : 0,
        title: o.title || 'New Event',
        colour,
        moved: false,
        target: null,
      };
      trackPress(e, {
        move: (m) => {
          if (!p.moved && Math.hypot(m.clientX - p.x, m.clientY - p.y) < SLOP) return;
          p.moved = true;
          const l = landing(app, p, m);
          p.target = l?.times ?? null;
          app.dragGhost.value = l?.ghost ?? null;
        },
        up: (u) => {
          app.dragGhost.value = null;
          if (!p.moved) return;
          droppedAt = performance.now();
          if (p.target) dropEvent(app, ref, p.target, u.altKey && p.mode === 'move');
        },
        cancel: () => {
          app.dragGhost.value = null;
          if (p.moved) droppedAt = performance.now();
        },
      });
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !cancelPress()) return;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
