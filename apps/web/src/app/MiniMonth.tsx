import {
  addDays,
  addMonths,
  busyLevel,
  datePart,
  formatPlainDate,
  monthGrid,
  startOfWeek,
  type PlainDate,
  type Weekday,
} from '@daybird/core';
import { moveStop, takeStop } from '@daybird/ui';

export interface MiniMonthProps {
  /** Any date in the month to show. */
  readonly month: PlainDate;
  readonly today: PlainDate;
  readonly weekStart: Weekday;
  readonly locale: string | undefined;
  /** Dates shaded as the shown range, from `start` up to `end`. */
  readonly shaded?: { readonly start: PlainDate; readonly end: PlainDate };
  readonly onPick: (date: PlainDate) => void;
  /** Events per day: a dot under the day (§5.2), or with `tint` a shade of the accent by how many (§6.3). */
  readonly counts?: ReadonlyMap<PlainDate, number>;
  readonly tint?: boolean;
  /**
   * The day the keyboard is on: the one tab stop, when it is in this month. Arrow keys, Page Up and Down, Home and
   * End call `onMove` with the next day, and focus follows once the app shows it.
   */
  readonly focus?: PlainDate;
  readonly onMove?: (date: PlainDate) => void;
  /**
   * The keys' scope, `data-roving` (§5.2): the month itself, or false when its parent is one (Year view's twelve,
   * where the keys cross from one month into the next).
   */
  readonly scope?: boolean;
  /** Shows the month name as a heading. */
  readonly heading?: boolean;
  readonly onHeading?: () => void;
}

const isShaded = (props: MiniMonthProps, d: PlainDate) =>
  !!props.shaded && d >= props.shaded.start && d < props.shaded.end;

/** A small month of day numbers: the sidebar's (PRD §5.2) and each of Year view's twelve (§6.3). */
export function MiniMonth(props: MiniMonthProps) {
  const { start, end } = monthGrid(props.month, props.weekStart);
  const { month } = datePart(props.month);
  const days: PlainDate[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  const label = formatPlainDate(props.month, props.locale, { month: 'long', year: 'numeric' });
  const inMonth = (d: PlainDate) =>
    datePart(d).month === month && datePart(d).year === datePart(props.month).year;
  // The tab stop: the keyboard's day when it is in this month, else (in the sidebar, paged away) the 1st.
  const stop =
    props.focus && inMonth(props.focus) ? props.focus : props.scope === false ? null : days.find(inMonth)!;
  return (
    <div class="db-mini" data-roving={props.scope === false ? undefined : ''}>
      {props.heading && (
        <button type="button" class="db-mini-heading" onClick={props.onHeading}>
          {formatPlainDate(props.month, props.locale, { month: 'long' })}
        </button>
      )}
      <div
        class="db-mini-grid"
        role="grid"
        aria-label={label}
        onKeyDown={(e) => {
          const from = (e.target as HTMLElement).dataset.day as PlainDate | undefined;
          const to =
            from && !e.altKey && !e.ctrlKey && !e.metaKey ? dayStep(e.key, from, props.weekStart) : null;
          if (!to || !props.onMove) return;
          e.preventDefault();
          e.stopPropagation();
          const move = props.onMove;
          moveStop(e.currentTarget, () => move(to));
        }}
      >
        <div role="row" class="db-mini-row">
          {days.slice(0, 7).map((d) => (
            <span
              key={d}
              role="columnheader"
              class="db-mini-weekday"
              aria-label={weekdayName(d, props.locale)}
            >
              {formatPlainDate(d, props.locale, { weekday: 'short' }).slice(0, 2)}
            </span>
          ))}
        </div>
        {weeks(days).map((week) => (
          <div role="row" class="db-mini-row" key={week[0]}>
            {week.map((d) => {
              const outside = datePart(d).month !== month;
              const shaded = isShaded(props, d);
              const cls = [
                'db-mini-day',
                outside && 'db-outside',
                shaded && 'db-shaded',
                // The shaded range is a band with round ends where it starts and stops; where it wraps
                // to the next week row, both edges stay square.
                shaded && !isShaded(props, addDays(d, -1)) && 'db-shade-start',
                shaded && !isShaded(props, addDays(d, 1)) && 'db-shade-end',
                d === props.today && 'db-today',
                busy(props, d),
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  class={cls}
                  tabIndex={d === stop && !outside ? 0 : -1}
                  ref={d === stop && !outside ? takeStop : undefined}
                  data-day={d}
                  aria-selected={d === props.focus && !outside}
                  aria-label={dayLabel(props, d)}
                  aria-current={d === props.today ? 'date' : undefined}
                  onClick={() => props.onPick(d)}
                >
                  {datePart(d).day}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The day a key moves the keyboard to in a month grid, or null for another key. */
export function dayStep(key: string, d: PlainDate, weekStart: Weekday): PlainDate | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(d, -1);
    case 'ArrowRight':
      return addDays(d, 1);
    case 'ArrowUp':
      return addDays(d, -7);
    case 'ArrowDown':
      return addDays(d, 7);
    case 'PageUp':
      return addMonths(d, -1);
    case 'PageDown':
      return addMonths(d, 1);
    case 'Home':
      return startOfWeek(d, weekStart);
    case 'End':
      return addDays(startOfWeek(d, weekStart), 6);
    default:
      return null;
  }
}

function weekdayName(d: PlainDate, locale: string | undefined): string {
  return formatPlainDate(d, locale, { weekday: 'long' });
}

function weeks(days: readonly PlainDate[]): PlainDate[][] {
  const out: PlainDate[][] = [];
  for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
  return out;
}

function busy(props: MiniMonthProps, d: PlainDate): string | false {
  const n = props.counts?.get(d) ?? 0;
  if (!n) return false;
  return props.tint ? `db-busy-${busyLevel(n)}` : 'db-busy';
}

function dayLabel(props: MiniMonthProps, d: PlainDate): string {
  const n = props.counts?.get(d) ?? 0;
  const date = formatPlainDate(d, props.locale, { dateStyle: 'full' });
  return n ? `${date}, ${n} ${n === 1 ? 'event' : 'events'}` : date;
}
