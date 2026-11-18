/** Recurrence rules in plain English (PRD §8.1): "Every month on the last Friday, 10 times". */
import { type PlainDate } from '../plainDate.ts';
import { type Frequency, type RecurrenceRule, type WeekdayNum } from './rrule.ts';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
const UNITS: Record<Frequency, string> = {
  SECONDLY: 'second',
  MINUTELY: 'minute',
  HOURLY: 'hour',
  DAILY: 'day',
  WEEKLY: 'week',
  MONTHLY: 'month',
  YEARLY: 'year',
};

function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function nth(n: number): string {
  if (n === -1) return 'last';
  if (n === -2) return 'second to last';
  if (n > 0 && n < ORDINALS.length) return ORDINALS[n] ?? '';
  const abs = Math.abs(n);
  const suffix = abs % 100 >= 11 && abs % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][abs % 10] ?? 'th');
  return n < 0 ? `${abs}${suffix} to last` : `${abs}${suffix}`;
}

function monthDayWords(days: readonly number[]): string {
  if (days.length === 1 && days[0] === -1) return 'the last day';
  if (days.every((d) => d > 0)) return `day${days.length > 1 ? 's' : ''} ${andList(days.map(String))}`;
  return andList(days.map((d) => (d > 0 ? `day ${d}` : `the ${nth(d)} day`)));
}

const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];

function isWeekdays(days: readonly WeekdayNum[]): boolean {
  return (
    days.length === 5 &&
    days.every((d) => d.ordinal === 0) &&
    WEEKDAYS_MON_FRI.every((w) => days.some((d) => d.weekday === w))
  );
}

function formatDateWords(date: PlainDate): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1]?.slice(0, 3)} ${d}, ${y}`;
}

/** The rule in English (PRD §8.1), from the series start `start` (a date). */
export function describeRule(r: RecurrenceRule, start: PlainDate): string {
  const [, sm, sd] = start.split('-').map(Number);
  const every = r.interval === 1 ? `Every ${UNITS[r.freq]}` : `Every ${r.interval} ${UNITS[r.freq]}s`;
  let text = every;
  let described = new Set<string>(['freq', 'interval']);
  const dayNames = (days: readonly WeekdayNum[]): string =>
    andList(
      days.map((d) =>
        d.ordinal ? `the ${nth(d.ordinal)} ${DAY_NAMES[d.weekday]}` : (DAY_NAMES[d.weekday] ?? ''),
      ),
    );
  if (r.freq === 'DAILY' && r.interval === 1 && isWeekdays(r.byDay)) {
    text = 'Every weekday';
    described.add('byDay');
  } else if (r.freq === 'WEEKLY') {
    if (r.interval === 1 && isWeekdays(r.byDay)) {
      text = 'Every weekday';
    } else if (r.byDay.length) {
      text += ` on ${dayNames(r.byDay.map((d) => ({ ...d, ordinal: 0 })))}`;
    }
    described.add('byDay');
  } else if (r.freq === 'MONTHLY') {
    if (r.byMonthDay.length && !r.byDay.length) {
      text += ` on ${monthDayWords(r.byMonthDay)}`;
      described.add('byMonthDay');
    } else if (r.byDay.length && !r.byMonthDay.length) {
      if (r.bySetPos.length === 1 && isWeekdays(r.byDay)) {
        text += ` on the ${nth(r.bySetPos[0] ?? 1)} weekday`;
        described.add('bySetPos');
      } else if (r.byDay.every((d) => d.ordinal !== 0)) {
        text += ` on ${dayNames(r.byDay)}`;
      } else if (r.bySetPos.length === 1 && r.byDay.length === 1) {
        text += ` on the ${nth(r.bySetPos[0] ?? 1)} ${DAY_NAMES[r.byDay[0]?.weekday ?? 0]}`;
        described.add('bySetPos');
      } else {
        text += ` on every ${andList(r.byDay.map((d) => DAY_NAMES[d.weekday] ?? ''))}`;
      }
      described.add('byDay');
    } else if (!r.byDay.length && !r.byMonthDay.length) {
      text += ` on day ${sd}`;
    }
  } else if (r.freq === 'YEARLY') {
    const months = r.byMonth.length ? r.byMonth : [sm ?? 1];
    const monthWords = andList(months.map((m) => MONTH_NAMES[m - 1] ?? ''));
    if (
      r.byDay.length &&
      r.byDay.every((d) => d.ordinal !== 0) &&
      !r.byMonthDay.length &&
      !r.byWeekNo.length &&
      !r.byYearDay.length
    ) {
      text += ` on ${dayNames(r.byDay)} of ${monthWords}`;
      described = new Set([...described, 'byDay', 'byMonth']);
    } else if (!r.byDay.length && !r.byWeekNo.length && !r.byYearDay.length) {
      const days = r.byMonthDay.length ? r.byMonthDay : [sd ?? 1];
      text +=
        days.length === 1 && (days[0] ?? 0) > 0
          ? ` on ${monthWords} ${days[0]}`
          : ` on ${monthDayWords(days)} of ${monthWords}`;
      described = new Set([...described, 'byMonthDay', 'byMonth']);
    }
  }
  const rest: [string, readonly unknown[]][] = [
    ['byDay', r.byDay],
    ['byMonthDay', r.byMonthDay],
    ['byMonth', r.byMonth],
    ['byYearDay', r.byYearDay],
    ['byWeekNo', r.byWeekNo],
    ['bySetPos', r.bySetPos],
    ['byHour', r.byHour],
    ['byMinute', r.byMinute],
    ['bySecond', r.bySecond],
  ];
  if (rest.some(([name, values]) => values.length > 0 && !described.has(name)))
    text += ', with more conditions';
  if (r.count !== null) text += r.count === 1 ? ', once' : `, ${r.count} times`;
  if (r.until)
    text += `, until ${formatDateWords(r.until.kind === 'date' ? r.until.date : r.until.dateTime.slice(0, 10))}`;
  return text;
}
