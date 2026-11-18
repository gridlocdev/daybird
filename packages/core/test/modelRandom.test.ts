import { expect, it } from 'vitest';
import {
  checkInvariants,
  createEvent,
  deleteOccurrence,
  diffStep,
  editOccurrence,
  emptyTrashDocument,
  EMPTY_UNDO,
  fromLocalSeconds,
  loadCalendar,
  occurrencesIn,
  pushStep,
  redo,
  restoreTrashEntry,
  rule,
  toLocalSeconds,
  trashEntries,
  undo,
  writeCalendar,
  readCalendar,
  type EditContext,
  type Scope,
  type TimeValue,
  type UndoStack,
  type Workspace,
} from '@daybird/core';
import { RANDOM_TIMEOUT, runRandomOps, type Random } from './support/randomOps.ts';

const ZONES = ['Europe/London', 'America/New_York', 'Asia/Tokyo'] as const;
const DISPLAY = 'Europe/London';
const FROM = toLocalSeconds('2026-10-01T00:00:00');
const TO = toLocalSeconds('2027-03-01T00:00:00');

interface State {
  ws: Workspace;
  start: Workspace;
  stack: UndoStack;
  ctx: EditContext;
}

function time(random: Random, allDay: boolean): { start: TimeValue; end: TimeValue } {
  const day = toLocalSeconds('2026-10-20T00:00:00') + random.int(60) * 86_400;
  if (allDay) {
    const d = fromLocalSeconds(day).slice(0, 10);
    const e = fromLocalSeconds(day + (1 + random.int(3)) * 86_400).slice(0, 10);
    return { start: { kind: 'date', date: d }, end: { kind: 'date', date: e } };
  }
  const tzid = random.chance(0.2) ? null : random.pick(ZONES);
  const utc = tzid === null && random.chance(0.5);
  const s = day + random.int(96) * 900;
  const make = (secs: number): TimeValue => ({
    kind: 'date-time',
    dateTime: fromLocalSeconds(secs),
    utc,
    tzid,
  });
  return { start: make(s), end: make(s + random.int(12) * 900) };
}

function randomRule(random: Random) {
  const freq = random.pick(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const);
  return rule(freq, random.chance(0.5) ? { count: 1 + random.int(10) } : { interval: 1 + random.int(3) });
}

function pickOccurrence(state: State, random: Random) {
  const os = occurrencesIn(state.ws.calendars, FROM, TO, DISPLAY);
  return os.length ? random.pick(os) : null;
}

function record(state: State, label: string, next: Workspace): void {
  state.stack = pushStep(state.stack, diffStep(label, state.ws, next));
  state.ws = next;
}

it(
  'random edits keep the invariants, and undoing every step gives back the start',
  () =>
    runRandomOps<State>({
      steps: 40,
      setup: () => {
        let n = 0;
        const ctx: EditContext = {
          now: toLocalSeconds('2026-11-17T12:00:00'),
          displayZone: DISPLAY,
          makeUid: () => `r-${++n}`,
        };
        const empty = (id: string) =>
          loadCalendar(id, 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', ctx.makeUid, []).calendar;
        const ws: Workspace = { calendars: [empty('A.ics'), empty('B.ics')], trash: emptyTrashDocument() };
        return { ws, start: ws, stack: EMPTY_UNDO, ctx };
      },
      ops: [
        {
          name: 'create',
          weight: 3,
          run: (s, r) => {
            const t = time(r, r.chance(0.3));
            const calendarId = r.pick(['A.ics', 'B.ics']);
            const next = createEvent(s.ws, s.ctx, calendarId, {
              title: r.text(),
              ...t,
              rule: r.chance(0.6) ? randomRule(r) : null,
            });
            record(s, 'create', next.workspace);
            return `${calendarId} ${JSON.stringify(t.start)}`;
          },
        },
        {
          name: 'edit',
          weight: 4,
          run: (s, r) => {
            const o = pickOccurrence(s, r);
            if (!o) return 'nothing';
            const scope = r.pick<Scope>(['this', 'future', 'all']);
            const kind = r.int(4);
            const shift = (r.int(9) - 4) * 3600;
            const patch =
              kind === 0
                ? { title: r.text() }
                : kind === 1
                  ? { rule: scope === 'this' ? undefined : r.chance(0.2) ? null : randomRule(r) }
                  : kind === 2
                    ? o.allDay
                      ? {
                          start: {
                            kind: 'date',
                            date: fromLocalSeconds(toLocalSeconds(`${o.startDate}T00:00:00`) + 86_400).slice(
                              0,
                              10,
                            ),
                          } as TimeValue,
                          end: {
                            kind: 'date',
                            date: fromLocalSeconds(toLocalSeconds(`${o.endDate}T00:00:00`) + 86_400).slice(
                              0,
                              10,
                            ),
                          } as TimeValue,
                        }
                      : {
                          start: {
                            kind: 'date-time',
                            dateTime: fromLocalSeconds(toLocalSeconds(o.ownStart) + shift),
                            utc: false,
                            tzid: o.tzid,
                          } as TimeValue,
                        }
                    : time(r, r.chance(0.3));
            const to = r.chance(0.15) ? r.pick(['A.ics', 'B.ics']) : o.calendarId;
            const ref = { calendarId: o.calendarId, uid: o.uid, key: o.key };
            const next = editOccurrence(s.ws, s.ctx, ref, patch, scope, to);
            record(s, 'edit', next.workspace);
            return `${o.calendarId} ${o.uid} ${o.key} ${scope} ${JSON.stringify(patch)} → ${to}`;
          },
        },
        {
          name: 'delete',
          weight: 2,
          run: (s, r) => {
            const o = pickOccurrence(s, r);
            if (!o) return 'nothing';
            const scope = r.pick<Scope>(['this', 'future', 'all']);
            record(
              s,
              'delete',
              deleteOccurrence(s.ws, s.ctx, { calendarId: o.calendarId, uid: o.uid, key: o.key }, scope),
            );
            return `${o.uid} ${o.key} ${scope}`;
          },
        },
        {
          name: 'restore',
          when: (s) => trashEntries(s.ws.trash).length > 0,
          run: (s, r) => {
            const e = r.pick(trashEntries(s.ws.trash));
            record(s, 'restore', restoreTrashEntry(s.ws, s.ctx, e.id, 'A.ics'));
            return `${e.kind} ${e.id}`;
          },
        },
        {
          name: 'undo',
          when: (s) => s.stack.done.length > 0,
          run: (s) => {
            const u = undo(s.ws, s.stack);
            if (u) [s.ws, s.stack] = [u.workspace, u.stack];
          },
        },
        {
          name: 'redo',
          when: (s) => s.stack.undone.length > 0,
          run: (s) => {
            const u = redo(s.ws, s.stack);
            if (u) [s.ws, s.stack] = [u.workspace, u.stack];
          },
        },
      ],
      check: (s) => {
        expect(checkInvariants(s.ws, DISPLAY)).toEqual([]);
        for (const c of s.ws.calendars) {
          // What's written reads back to the same events.
          const text = writeCalendar(c.document);
          const again = readCalendar(text);
          expect(again.ok && writeCalendar(again.calendar)).toBe(text);
        }
      },
      finish: (s) => {
        let ws = s.ws;
        let stack = s.stack;
        for (let u = undo(ws, stack); u; u = undo(ws, stack)) [ws, stack] = [u.workspace, u.stack];
        expect(ws.calendars.map((c) => writeCalendar(c.document))).toEqual(
          s.start.calendars.map((c) => writeCalendar(c.document)),
        );
        expect(ws.trash).toBe(s.start.trash);
      },
    }),
  RANDOM_TIMEOUT,
);
