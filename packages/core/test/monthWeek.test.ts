import { describe, expect, it } from 'vitest';
import { addDays, dayBounds, daysCovered, layoutMonthWeek, type MonthItem } from '../src/index.ts';
import { RANDOM_TIMEOUT, runRandomOps } from './support/randomOps.ts';

const zone = 'America/New_York';
const WEEK = Array.from({ length: 7 }, (_, i) => addDays('2026-11-15', i));

interface Item extends MonthItem {
  readonly name: string;
}

const timed = (name: string, day: string, hour: number, hours = 1): Item => {
  const start = dayBounds(day, zone).start + hour * 3600;
  return { name, start, end: start + hours * 3600, allDay: false, startDate: null, endDate: null };
};
const allDay = (name: string, from: string, to: string): Item => ({
  name,
  start: dayBounds(from, zone).start,
  end: dayBounds(to, zone).start,
  allDay: true,
  startDate: from,
  endDate: to,
});

describe('a Month week', () => {
  it('covers the days an event touches in the display zone, not the day it ends at midnight', () => {
    expect(daysCovered(timed('a', '2026-11-17', 9), zone)).toEqual({
      startDate: '2026-11-17',
      endDate: '2026-11-18',
    });
    expect(daysCovered(timed('b', '2026-11-17', 22, 2), zone)).toEqual({
      startDate: '2026-11-17',
      endDate: '2026-11-18',
    });
    expect(daysCovered(timed('c', '2026-11-17', 22, 3), zone).endDate).toBe('2026-11-19');
  });

  it('draws multi-day timed events as bars and fills free lanes with lines in start order', () => {
    const w = layoutMonthWeek(
      [
        timed('late', '2026-11-17', 15),
        allDay('trip', '2026-11-16', '2026-11-19'),
        timed('early', '2026-11-17', 8),
        timed('overnight', '2026-11-18', 22, 4),
      ],
      WEEK,
      zone,
      5,
    );
    expect(w.bars.map((b) => [b.item.name, b.first, b.last, b.row])).toEqual([
      ['trip', 1, 3, 0],
      ['overnight', 3, 4, 1],
    ]);
    expect(w.lines.map((l) => [l.item.name, l.day, l.lane])).toEqual([
      ['early', 2, 1],
      ['late', 2, 2],
    ]);
    expect(w.more).toEqual([]);
    expect(w.days[2]!.map((i) => i.name)).toEqual(['trip', 'early', 'late']);
  });

  it('keeps the last lane for "N more" on a day with too many', () => {
    const items = [0, 1, 2, 3].map((h) => timed(`e${h}`, '2026-11-17', 9 + h));
    const w = layoutMonthWeek(items, WEEK, zone, 3);
    expect(w.lines.map((l) => l.item.name)).toEqual(['e0', 'e1']);
    expect(w.more).toEqual([{ day: 2, lane: 2, count: 2 }]);
    expect(layoutMonthWeek(items, WEEK, zone, 4).more).toEqual([]);
  });

  it('hides a bar that can’t show on every day it crosses, and counts it on each', () => {
    const items = [
      allDay('a', '2026-11-16', '2026-11-17'),
      allDay('b', '2026-11-16', '2026-11-17'),
      allDay('span', '2026-11-16', '2026-11-19'),
    ];
    const w = layoutMonthWeek(items, WEEK, zone, 2);
    expect(w.bars.map((b) => b.item.name)).toEqual(['span']);
    expect(w.more).toEqual([{ day: 1, lane: 1, count: 2 }]);
  });

  it(
    'never overlaps two things in a lane and accounts for every event on every day',
    async () => {
      await runRandomOps<{ items: Item[] }>({
        setup: () => ({ items: [] }),
        ops: [
          {
            name: 'add timed',
            weight: 3,
            run: (w, r) => {
              w.items.push(timed(`t${w.items.length}`, r.pick(WEEK), r.int(24), r.pick([0.5, 1, 3, 30])));
            },
          },
          {
            name: 'add all-day',
            run: (w, r) => {
              const from = addDays('2026-11-13', r.int(10));
              w.items.push(allDay(`a${w.items.length}`, from, addDays(from, 1 + r.int(5))));
            },
          },
        ],
        steps: 40,
        check: (w) => {
          for (const lanes of [1, 2, 4, 8]) {
            const out = layoutMonthWeek(w.items, WEEK, zone, lanes);
            for (let d = 0; d < 7; d++) {
              const used = [
                ...out.bars.filter((b) => b.first <= d && b.last >= d).map((b) => b.row),
                ...out.lines.filter((l) => l.day === d).map((l) => l.lane),
                ...out.more.filter((m) => m.day === d).map((m) => m.lane),
              ];
              expect(new Set(used).size, `lanes on day ${d}`).toBe(used.length);
              expect(used.every((l) => l < lanes)).toBe(true);
              const shown = used.length - out.more.filter((m) => m.day === d).length;
              const hidden = out.more.find((m) => m.day === d)?.count ?? 0;
              expect(shown + hidden, `events on day ${d}`).toBe(out.days[d]!.length);
            }
          }
        },
      });
    },
    RANDOM_TIMEOUT,
  );
});
