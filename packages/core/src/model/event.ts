/**
 * One VEVENT read into the fields Daybird shows and edits (PRD §3.2, §4.1, §7.2), and edits written back into
 * the component so properties Daybird doesn't use stay where they were (§3.3).
 */
import { addDays, diffDays } from '../plainDate.ts';
import { escapeText, unescapeText } from '../ical/contentLine.ts';
import {
  componentNode,
  components,
  paramValue,
  properties,
  property,
  propertyNode,
  withAddedProperty,
  withChildren,
  withProperty,
  withoutProperty,
  type ComponentNode,
} from '../ical/document.ts';
import {
  formatDuration,
  formatTimeText,
  parseDuration,
  readTimeList,
  readTimeProperty,
  timeParams,
  type Duration,
  type TimeValue,
} from '../ical/values.ts';
import { SECONDS_PER_DAY, addSeconds, toLocalSeconds } from '../time/dateTime.ts';
import { formatRule, parseRule, type RecurrenceRule } from '../time/rrule.ts';

/** A reminder (PRD §9): seconds before the start (negative: after), or an absolute UTC time. */
export type Reminder =
  { readonly kind: 'before'; readonly seconds: number } | { readonly kind: 'at'; readonly utc: TimeValue };

/** What a VEVENT says, as Daybird reads it. Text fields are unescaped. */
export interface EventInfo {
  readonly uid: string;
  readonly recurrenceId: TimeValue | null;
  readonly start: TimeValue;
  /** From DTEND, else DTSTART plus DURATION, else the start (timed) or the next day (all-day). */
  readonly end: TimeValue;
  readonly allDay: boolean;
  readonly title: string;
  readonly location: string;
  readonly notes: string;
  readonly url: string;
  readonly rules: readonly RecurrenceRule[];
  readonly exRules: readonly RecurrenceRule[];
  readonly rDates: readonly TimeValue[];
  readonly exDates: readonly TimeValue[];
  readonly reminders: readonly Reminder[];
  readonly sequence: number;
  /** What couldn't be read, in words, for the popover (§3.2, §4.3, §4.4). */
  readonly problems: readonly string[];
}

const NO_START: TimeValue = { kind: 'date', date: '1970-01-01' };

function text(event: ComponentNode, name: string): string {
  const p = property(event, name);
  return p ? unescapeText(p.value) : '';
}

/** Adds a duration to a time value, keeping its kind and zone. Days and weeks are nominal (RFC 5545 §3.3.6). */
export function addDuration(value: TimeValue, d: Duration): TimeValue {
  const sign = d.negative ? -1 : 1;
  const days = sign * (d.weeks * 7 + d.days);
  if (value.kind === 'date')
    return { kind: 'date', date: addDays(value.date, days + sign * Math.floor(d.seconds / SECONDS_PER_DAY)) };
  return { ...value, dateTime: addSeconds(value.dateTime, days * SECONDS_PER_DAY + sign * d.seconds) };
}

/** Wall-clock seconds of a value: midnight for a date. Only comparable between values in the same zone. */
export function wallSeconds(value: TimeValue): number {
  return value.kind === 'date' ? toLocalSeconds(`${value.date}T00:00:00`) : toLocalSeconds(value.dateTime);
}

function sameFrame(a: TimeValue, b: TimeValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'date' || b.kind === 'date') return true;
  return a.utc === b.utc && a.tzid === b.tzid;
}

/** The reminders of an event (PRD §9): VALARMs with ACTION DISPLAY or AUDIO. Others are kept but not shown. */
function readReminders(event: ComponentNode): Reminder[] {
  const out: Reminder[] = [];
  for (const alarm of components(event, 'VALARM')) {
    const action = property(alarm, 'ACTION')?.value.trim().toUpperCase();
    if (action !== 'DISPLAY' && action !== 'AUDIO') continue;
    const trigger = property(alarm, 'TRIGGER');
    if (!trigger) continue;
    if (paramValue(trigger, 'VALUE')?.toUpperCase() === 'DATE-TIME') {
      const at = readTimeProperty(trigger);
      if (at) out.push({ kind: 'at', utc: at });
      continue;
    }
    const d = parseDuration(trigger.value);
    if (!d) continue;
    const seconds = (d.weeks * 7 + d.days) * SECONDS_PER_DAY + d.seconds;
    out.push({ kind: 'before', seconds: d.negative ? seconds : -seconds });
  }
  return out;
}

/** Reads a VEVENT. Never fails: what can't be read is listed in `problems` and left in the file. */
export function readEvent(event: ComponentNode): EventInfo {
  const problems: string[] = [];
  const startLine = property(event, 'DTSTART');
  let start = startLine ? readTimeProperty(startLine) : null;
  if (!start) {
    problems.push(startLine ? `Couldn't read the start "${startLine.value}".` : 'The event has no start.');
    start = NO_START;
  }
  const allDay = start.kind === 'date';
  let end: TimeValue | null = null;
  const endLine = property(event, 'DTEND');
  const durationLine = property(event, 'DURATION');
  if (endLine) {
    end = readTimeProperty(endLine);
    if (!end) problems.push(`Couldn't read the end "${endLine.value}".`);
    else if (end.kind !== start.kind) {
      problems.push('The end and start were of different kinds, so the end was set from the start.');
      end = null;
    }
  } else if (durationLine) {
    const d = parseDuration(durationLine.value);
    if (d && !d.negative) end = addDuration(start, d);
    else problems.push(`Couldn't read the length "${durationLine.value}".`);
  }
  end ??= allDay && start.kind === 'date' ? { kind: 'date', date: addDays(start.date, 1) } : start;
  if (sameFrame(start, end) && wallSeconds(end) < wallSeconds(start)) {
    problems.push('The end was before the start, so it was set to the start.');
    end = start;
  }
  if (allDay && start.kind === 'date' && end.kind === 'date' && diffDays(start.date, end.date) < 1) {
    end = { kind: 'date', date: addDays(start.date, 1) };
  }

  const rules: RecurrenceRule[] = [];
  const exRules: RecurrenceRule[] = [];
  for (const [name, into] of [
    ['RRULE', rules],
    ['EXRULE', exRules],
  ] as const) {
    for (const line of properties(event, name)) {
      const parsed = parseRule(line.value);
      if (parsed.ok) into.push(parsed.rule);
      else problems.push(`Couldn't read the repeat rule: ${parsed.message}`);
    }
  }
  const rDates: TimeValue[] = [];
  const exDates: TimeValue[] = [];
  for (const [name, into] of [
    ['RDATE', rDates],
    ['EXDATE', exDates],
  ] as const) {
    for (const line of properties(event, name)) {
      const list = readTimeList(line);
      if (list) into.push(...list);
      else
        problems.push(
          `Couldn't read ${name === 'RDATE' ? 'an extra date' : 'a skipped date'} "${line.value}".`,
        );
    }
  }
  const ridLine = property(event, 'RECURRENCE-ID');
  const recurrenceId = ridLine ? readTimeProperty(ridLine) : null;
  if (ridLine && !recurrenceId)
    problems.push(`Couldn't read which occurrence this changes "${ridLine.value}".`);
  const sequence = Number.parseInt(property(event, 'SEQUENCE')?.value ?? '0', 10);

  return {
    uid: property(event, 'UID')?.value.trim() ?? '',
    recurrenceId,
    start,
    end,
    allDay,
    title: text(event, 'SUMMARY'),
    location: text(event, 'LOCATION'),
    notes: text(event, 'DESCRIPTION'),
    url: property(event, 'URL')?.value.trim() ?? '',
    rules,
    exRules,
    rDates,
    exDates,
    reminders: readReminders(event),
    sequence: Number.isFinite(sequence) ? sequence : 0,
    problems,
  };
}

/** The fields an edit can change. Missing fields stay as they are. */
export interface EventPatch {
  readonly title?: string;
  readonly location?: string;
  readonly notes?: string;
  readonly url?: string;
  readonly start?: TimeValue;
  readonly end?: TimeValue;
  /** Null removes the repeat. Never applied to an override. */
  readonly rule?: RecurrenceRule | null;
  readonly reminders?: readonly Reminder[];
}

function withText(event: ComponentNode, name: string, value: string): ComponentNode {
  return value === ''
    ? withoutProperty(event, name)
    : withProperty(event, propertyNode(name, escapeText(value)));
}

/** Sets a time property, keeping the value's VALUE=DATE or TZID parameter. */
export function withTime(event: ComponentNode, name: string, value: TimeValue): ComponentNode {
  return withProperty(event, propertyNode(name, formatTimeText(value), timeParams(value)));
}

/** Replaces the RDATE or EXDATE lines with one line per value, in order. */
export function withTimeList(
  event: ComponentNode,
  name: 'RDATE' | 'EXDATE',
  values: readonly TimeValue[],
): ComponentNode {
  let out = withoutProperty(event, name);
  for (const v of values) out = withAddedProperty(out, propertyNode(name, formatTimeText(v), timeParams(v)));
  return out;
}

function alarmFor(reminder: Reminder): ComponentNode {
  const trigger =
    reminder.kind === 'at'
      ? propertyNode('TRIGGER', formatTimeText(reminder.utc), [{ name: 'VALUE', values: ['DATE-TIME'] }])
      : propertyNode(
          'TRIGGER',
          formatDuration({
            negative: reminder.seconds > 0,
            weeks: 0,
            days: Math.floor(Math.abs(reminder.seconds) / SECONDS_PER_DAY),
            seconds: Math.abs(reminder.seconds) % SECONDS_PER_DAY,
          }),
        );
  return componentNode('VALARM', [
    propertyNode('ACTION', 'DISPLAY'),
    propertyNode('DESCRIPTION', 'Reminder'),
    trigger,
  ]);
}

function sameReminders(a: readonly Reminder[], b: readonly Reminder[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Writes the reminders: shown VALARMs are replaced in place by the new list, VALARMs Daybird doesn't show
 * (EMAIL) stay.
 */
function withReminders(event: ComponentNode, reminders: readonly Reminder[]): ComponentNode {
  if (sameReminders(readReminders(event), reminders)) return event;
  const shown = (c: ComponentNode) => {
    const action = property(c, 'ACTION')?.value.trim().toUpperCase();
    return c.name === 'VALARM' && (action === 'DISPLAY' || action === 'AUDIO');
  };
  const kept = event.children.filter((c) => !(c.kind === 'component' && shown(c)));
  return withChildren(event, [...kept, ...reminders.map(alarmFor)]);
}

/**
 * Applies a patch. The end is written as DTEND (a DURATION is replaced), and an all-day event's end is the day
 * after its last day (RFC 5545). Returns the same component when nothing changed.
 */
export function withPatch(event: ComponentNode, patch: EventPatch): ComponentNode {
  let out = event;
  if (patch.title !== undefined) out = withText(out, 'SUMMARY', patch.title);
  if (patch.location !== undefined) out = withText(out, 'LOCATION', patch.location);
  if (patch.notes !== undefined) out = withText(out, 'DESCRIPTION', patch.notes);
  if (patch.url !== undefined)
    out =
      patch.url.trim() === ''
        ? withoutProperty(out, 'URL')
        : withProperty(out, propertyNode('URL', patch.url.trim()));
  if (patch.start !== undefined || patch.end !== undefined) {
    const info = readEvent(out);
    const start = patch.start ?? info.start;
    const end = patch.end ?? info.end;
    if (JSON.stringify(start) !== JSON.stringify(info.start)) out = withTime(out, 'DTSTART', start);
    if (
      JSON.stringify(end) !== JSON.stringify(info.end) ||
      property(out, 'DURATION') ||
      JSON.stringify(start) !== JSON.stringify(info.start)
    ) {
      out = withoutProperty(out, 'DURATION');
      out = withTime(out, 'DTEND', end);
    }
  }
  if (patch.rule !== undefined) {
    const current = properties(out, 'RRULE').map((p) => p.value);
    const next = patch.rule ? [formatRule(patch.rule)] : [];
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      out = withoutProperty(withoutProperty(out, 'RRULE'), 'EXRULE');
      if (patch.rule) out = withProperty(out, propertyNode('RRULE', formatRule(patch.rule)));
      else out = withoutProperty(withoutProperty(out, 'RDATE'), 'EXDATE');
    }
  }
  if (patch.reminders !== undefined) out = withReminders(out, patch.reminders);
  return out;
}

/** UTC `YYYYMMDDTHHMMSSZ` for DTSTAMP and LAST-MODIFIED. */
export function utcStamp(utcSeconds: number): string {
  const d = new Date(utcSeconds * 1000).toISOString();
  return `${d.slice(0, 4)}${d.slice(5, 7)}${d.slice(8, 10)}T${d.slice(11, 13)}${d.slice(14, 16)}${d.slice(17, 19)}Z`;
}

/**
 * Marks an edited event (PRD §3.3): DTSTAMP and LAST-MODIFIED now, SEQUENCE raised when its time or rule
 * changed. Returns `after` unchanged when it is `before`.
 */
export function withEditStamps(
  before: ComponentNode | null,
  after: ComponentNode,
  now: number,
): ComponentNode {
  if (before === after) return after;
  const stamp = utcStamp(now);
  let out = withProperty(
    withProperty(after, propertyNode('DTSTAMP', stamp)),
    propertyNode('LAST-MODIFIED', stamp),
  );
  if (before) {
    const timing = (e: ComponentNode) =>
      ['DTSTART', 'DTEND', 'DURATION', 'RRULE', 'RDATE', 'EXDATE', 'EXRULE']
        .flatMap((n) => properties(e, n).map((p) => `${n}${JSON.stringify(p.params)}:${p.value}`))
        .join('\n');
    if (timing(before) !== timing(after)) {
      const seq = Number.parseInt(property(before, 'SEQUENCE')?.value ?? '0', 10);
      out = withProperty(out, propertyNode('SEQUENCE', String((Number.isFinite(seq) ? seq : 0) + 1)));
    }
  } else if (!property(out, 'CREATED')) {
    out = withProperty(out, propertyNode('CREATED', stamp));
  }
  return out;
}

/** A new VEVENT with the given fields. */
export function newEvent(
  uid: string,
  fields: EventPatch & { start: TimeValue; end: TimeValue },
  now: number,
): ComponentNode {
  const base = withTime(
    withTime(componentNode('VEVENT', [propertyNode('UID', uid)]), 'DTSTART', fields.start),
    'DTEND',
    fields.end,
  );
  return withEditStamps(null, withPatch(base, { ...fields, start: undefined, end: undefined }), now);
}
