import { describe, expect, it } from 'vitest';
import {
  MIN_EVENT_MINUTES,
  addDays,
  dayBars,
  dayBounds,
  daySegments,
  layoutDay,
  openingMinutes,
  rowCount,
  type Placed,
  type Segment,
} from '../src/index.ts';
import { RANDOM_TIMEOUT, runRandomOps } from './support/randomOps.ts';

const seg = (name: string, top: number, bottom: number): Segment<string> => ({
  item: name,
  top,
  bottom,
  continuesBefore: false,
  continuesAfter: false,
});

const byName = (placed: Placed<string>[]) =>
  Object.fromEntries(placed.map((p) => [p.item, [p.column, p.span, p.columns]]));

describe('the time grid', () => {
  const zone = 'America/New_York';

  it('cuts an event across midnight into both days, squared where it goes on', () => {
    const { start } = dayBounds('2026-11-17', zone);
    const late = { start: start + 22 * 3600, end: start + 26 * 3600 };
    const [first, second] = daySegments([late], ['2026-11-17', '2026-11-18'], zone);
    expect(first).toEqual([
      { item: late, top: 1320, bottom: 1440, continuesBefore: false, continuesAfter: true },
    ]);
    expect(second).toEqual([
      { item: late, top: 0, bottom: 120, continuesBefore: true, continuesAfter: false },
    ]);
  });

  it('leaves out an event that ends at midnight from the next day', () => {
    const { start, end } = dayBounds('2026-11-17', zone);
    const evening = { start: start + 23 * 3600, end };
    expect(daySegments([evening], ['2026-11-18'], zone)).toEqual([[]]);
  });

  it('draws a short event 15 minutes tall, inside the day', () => {
    const { start, end } = dayBounds('2026-11-17', zone);
    const [[early, late]] = daySegments(
      [
        { start: start + 600, end: start + 600 },
        { start: end - 60, end: end - 60 },
      ],
      ['2026-11-17'],
      zone,
    ) as [Segment<unknown>[]];
    expect([early!.top, early!.bottom]).toEqual([10, 10 + MIN_EVENT_MINUTES]);
    expect([late!.top, late!.bottom]).toEqual([1440 - MIN_EVENT_MINUTES, 1440]);
  });

  it('places events by the wall clock on a daylight-saving day', () => {
    // 8 March 2026: New York springs forward at 2:00, so the day is 23 hours long.
    const { start, end } = dayBounds('2026-03-08', zone);
    expect(end - start).toBe(23 * 3600);
    const nine = start + 8 * 3600; // 9:00 on the wall clock
    const [[s]] = daySegments([{ start: nine, end: nine + 3600 }], ['2026-03-08'], zone) as [
      Segment<unknown>[],
    ];
    expect([s!.top, s!.bottom]).toEqual([540, 600]);
  });

  it('splits overlapping events into columns and widens them into free ones', () => {
    const placed = layoutDay([
      seg('a', 540, 660), // 9–11
      seg('b', 570, 600), // 9:30–10
      seg('c', 600, 630), // 10–10:30, after b: b's column again
      seg('d', 720, 780), // a cluster of its own
    ]);
    expect(byName(placed)).toEqual({ a: [0, 1, 2], b: [1, 1, 2], c: [1, 1, 2], d: [0, 1, 1] });
  });

  it('puts the longer event left on a tie, and widens a later one right', () => {
    const placed = layoutDay([
      seg('short', 540, 570),
      seg('long', 540, 660),
      seg('third', 540, 600),
      seg('late', 600, 630),
    ]);
    // long and short and third start together: three columns; late can't use third's column... it widens into short's.
    expect(byName(placed)).toEqual({
      long: [0, 1, 3],
      third: [1, 1, 3],
      short: [2, 1, 3],
      late: [1, 2, 3],
    });
  });

  it('opens 30 minutes before now on today, else at the first hour', () => {
    expect(openingMinutes(600, 8)).toBe(570);
    expect(openingMinutes(10, 8)).toBe(0);
    expect(openingMinutes(null, 8)).toBe(480);
  });

  it(
    'never lets overlapping events share a column, and uses no more columns than the widest moment',
    async () => {
      await runRandomOps<{ segments: Segment<number>[] }>({
        setup: () => ({ segments: [] }),
        ops: [
          {
            name: 'add an event',
            run: (w, r) => {
              const top = r.int(1440 - MIN_EVENT_MINUTES);
              const bottom = Math.min(1440, top + MIN_EVENT_MINUTES + r.int(240));
              w.segments.push({
                item: w.segments.length,
                top,
                bottom,
                continuesBefore: false,
                continuesAfter: false,
              });
              return `${top}–${bottom}`;
            },
          },
        ],
        steps: 40,
        check: (w) => {
          const placed = layoutDay(w.segments);
          expect(placed).toHaveLength(w.segments.length);
          for (const p of placed) {
            expect(p.column + p.span).toBeLessThanOrEqual(p.columns);
            for (const q of placed) {
              if (p === q || !(p.top < q.bottom && q.top < p.bottom)) continue;
              const apart = p.column + p.span <= q.column || q.column + q.span <= p.column;
              expect(apart, `${p.item} and ${q.item} overlap in time and columns`).toBe(true);
              expect(p.columns).toBe(q.columns);
            }
            const widest = Math.max(
              ...placed
                .filter((q) => q.columns === p.columns && q.top < p.bottom && p.top < q.bottom)
                .map((q) => placed.filter((o) => o.top <= q.top && o.bottom > q.top).length),
            );
            expect(widest).toBeLessThanOrEqual(p.columns);
          }
        },
      });
    },
    RANDOM_TIMEOUT,
  );
});

describe('day bars', () => {
  const week = Array.from({ length: 7 }, (_, i) => addDays('2026-11-15', i));
  const span = (name: string, startDate: string, endDate: string) => ({ name, startDate, endDate });

  it('stacks bars in the lowest free row, longest first', () => {
    const bars = dayBars(
      [
        span('one day', '2026-11-16', '2026-11-17'),
        span('trip', '2026-11-16', '2026-11-19'),
        span('later', '2026-11-18', '2026-11-19'),
        span('after', '2026-11-19', '2026-11-20'),
      ],
      week,
    );
    expect(bars.map((b) => [b.item.name, b.first, b.last, b.row])).toEqual([
      ['trip', 1, 3, 0],
      ['one day', 1, 1, 1],
      ['later', 3, 3, 1],
      ['after', 4, 4, 0],
    ]);
    expect(rowCount(bars)).toBe(2);
  });

  it('cuts bars at the edges of the days shown and squares those ends', () => {
    const bars = dayBars(
      [span('long', '2026-11-10', '2026-11-30'), span('gone', '2026-11-01', '2026-11-15')],
      week,
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ first: 0, last: 6, continuesBefore: true, continuesAfter: true });
  });
});
