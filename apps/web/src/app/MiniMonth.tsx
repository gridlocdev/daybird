import {
  addDays,
  busyLevel,
  datePart,
  formatPlainDate,
  monthGrid,
  type PlainDate,
  type Weekday,
} from '@daybird/core';

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
  /** Shows the month name as a heading. */
  readonly heading?: boolean;
  readonly onHeading?: () => void;
}

/** A small month of day numbers: the sidebar's (PRD §5.2) and each of Year view's twelve (§6.3). */
export function MiniMonth(props: MiniMonthProps) {
  const { start, end } = monthGrid(props.month, props.weekStart);
  const { month } = datePart(props.month);
  const days: PlainDate[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  const label = formatPlainDate(props.month, props.locale, { month: 'long', year: 'numeric' });
  return (
    <div class="db-mini">
      {props.heading && (
        <button type="button" class="db-mini-heading" onClick={props.onHeading}>
          {formatPlainDate(props.month, props.locale, { month: 'long' })}
        </button>
      )}
      <div class="db-mini-grid" role="grid" aria-label={label}>
        <div role="row" class="db-mini-row">
          {days.slice(0, 7).map((d) => (
            <span
              key={d}
              role="columnheader"
              class="db-mini-weekday"
              aria-label={weekdayName(d, props.locale)}
            >
              {formatPlainDate(d, props.locale, { weekday: 'narrow' })}
            </span>
          ))}
        </div>
        {weeks(days).map((week) => (
          <div role="row" class="db-mini-row" key={week[0]}>
            {week.map((d) => {
              const outside = datePart(d).month !== month;
              const shaded = props.shaded && d >= props.shaded.start && d < props.shaded.end;
              const cls = [
                'db-mini-day',
                outside && 'db-outside',
                shaded && 'db-shaded',
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
                  tabIndex={-1}
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
