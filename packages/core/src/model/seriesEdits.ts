/**
 * Changing one occurrence, this and future occurrences, or all of a repeating series (PRD §8.2). Each function
 * takes a series and returns its new VEVENTs (master first, then overrides), plus a new series when the change
 * splits it. Nothing here stamps or saves; `workspace.ts` does that.
 */
import { addDays, diffDays } from '../plainDate.ts';
import {
  property,
  propertyNode,
  withProperty,
  withoutProperty,
  type ComponentNode,
} from '../ical/document.ts';
import type { TimeValue } from '../ical/values.ts';
import { SECONDS_PER_DAY, addSeconds, fromLocalSeconds } from '../time/dateTime.ts';
import { isInSet } from '../time/recurrenceSet.ts';
import { expandRule, formatRule, type RecurrenceRule, type RuleUntil } from '../time/rrule.ts';
import { toInstant, type Zone } from '../time/zones.ts';
import { seriesEvents, type EventSeries } from './calendar.ts';
import {
  readEvent,
  wallSeconds,
  withPatch,
  withTime,
  withTimeList,
  type EventInfo,
  type EventPatch,
} from './event.ts';
import { isRepeating, keyIn, recurrenceSetOf, valueAtKey, zoneOf } from './occurrences.ts';

export type Scope = 'this' | 'future' | 'all';

export interface SeriesContext {
  readonly zones: ReadonlyMap<string, Zone>;
  readonly displayZone: string;
  readonly makeUid: () => string;
}

/** A series' new events, and the new series a This and Future change starts. */
export interface SeriesChange {
  readonly events: readonly ComponentNode[];
  readonly split: EventSeries | null;
}

/** Moves a value by wall-clock seconds; a date by whole days. */
export function shiftValue(value: TimeValue, seconds: number): TimeValue {
  if (value.kind === 'date')
    return { kind: 'date', date: addDays(value.date, Math.round(seconds / SECONDS_PER_DAY)) };
  return { ...value, dateTime: addSeconds(value.dateTime, seconds) };
}

function sameFrame(a: TimeValue, b: TimeValue): boolean {
  if (a.kind === 'date' || b.kind === 'date') return a.kind === b.kind;
  return a.utc === b.utc && a.tzid === b.tzid;
}

function dateOfValue(v: TimeValue): string {
  return v.kind === 'date' ? v.date : v.dateTime.slice(0, 10);
}

/** `base` moved the way `from` moved to `to`: by the same wall-clock amount, or (when the kind or zone changed) to `to` on `base`'s date. */
function translate(base: TimeValue, from: TimeValue, to: TimeValue): TimeValue {
  if (sameFrame(from, to)) return shiftValue(base, wallSeconds(to) - wallSeconds(from));
  return shiftValue(to, diffDays(dateOfValue(from), dateOfValue(base)) * SECONDS_PER_DAY);
}

function keyOf(event: ComponentNode, masterStart: TimeValue, ctx: SeriesContext): number | null {
  const rid = readEvent(event).recurrenceId;
  return rid ? keyIn(rid, masterStart, ctx.zones, ctx.displayZone) : null;
}

/** The override for `key`, or null. */
export function overrideAt(series: EventSeries, key: number, ctx: SeriesContext): ComponentNode | null {
  if (!series.master) return null;
  const start = readEvent(series.master).start;
  return series.overrides.find((o) => keyOf(o, start, ctx) === key) ?? null;
}

function withoutRepeat(event: ComponentNode): ComponentNode {
  let e = event;
  for (const name of ['RRULE', 'RDATE', 'EXDATE', 'EXRULE']) e = withoutProperty(e, name);
  return e;
}

/** An override for occurrence `key` that is the master's occurrence as it stands. */
export function makeOverride(master: ComponentNode, key: number): ComponentNode {
  const info = readEvent(master);
  const shift = key - wallSeconds(info.start);
  let e = withTime(withoutRepeat(master), 'RECURRENCE-ID', valueAtKey(key, info.start));
  e = withTime(e, 'DTSTART', shiftValue(info.start, shift));
  return withTime(withoutProperty(e, 'DURATION'), 'DTEND', shiftValue(info.end, shift));
}

/** The occurrence's times as the master makes them, before any override moved it. */
function baseTimes(master: EventInfo, key: number | null): { start: TimeValue; end: TimeValue } {
  if (key === null) return { start: master.start, end: master.end };
  const shift = key - wallSeconds(master.start);
  return { start: shiftValue(master.start, shift), end: shiftValue(master.end, shift) };
}

const TEXT_FIELDS = ['title', 'location', 'notes', 'url'] as const;

/** This Event (§8.2): an override with RECURRENCE-ID. A repeat change is never applied to one occurrence. */
export function editThis(
  series: EventSeries,
  key: number,
  patch: EventPatch,
  ctx: SeriesContext,
): SeriesChange {
  if (!series.master) throw new Error('The series has no master.');
  const existing = overrideAt(series, key, ctx);
  const base = existing ?? makeOverride(series.master, key);
  const next = withPatch(base, { ...patch, rule: undefined });
  if (next === base) return { events: seriesEvents(series), split: null };
  const overrides = existing
    ? series.overrides.map((o) => (o === existing ? next : o))
    : [...series.overrides, next];
  return { events: [series.master, ...overrides], split: null };
}

/** The overrides' and dates' keys and values, rewritten after the master's start moved from `old` to `next`. */
function moveKeys(
  master: ComponentNode,
  old: EventInfo,
  nextStart: TimeValue,
  ctx: SeriesContext,
): ComponentNode {
  const delta = wallSeconds(nextStart) - wallSeconds(old.start);
  if (delta === 0 && sameFrame(old.start, nextStart)) return master;
  const move = (values: readonly TimeValue[]) =>
    values.map((v) => valueAtKey(keyIn(v, old.start, ctx.zones, ctx.displayZone) + delta, nextStart));
  let out = master;
  if (old.rDates.length) out = withTimeList(out, 'RDATE', move(old.rDates));
  if (old.exDates.length) out = withTimeList(out, 'EXDATE', move(old.exDates));
  return out;
}

/**
 * All Events (§8.2): changes the master. A time change moves overrides that kept the master's old time by the
 * same amount and leaves those the user moved; a text change reaches overrides that hadn't changed that field.
 * The occurrence the change was made on takes the whole change, override or not. A new time sets the master's
 * time as if it were made on the occurrence before any override moved it.
 * Overrides and skipped dates the new rule no longer makes are dropped.
 */
export function editAll(
  series: EventSeries,
  key: number | null,
  patch: EventPatch,
  ctx: SeriesContext,
): SeriesChange {
  if (!series.master) {
    // Only overrides, no master: each is its own event.
    const events = series.overrides.map((o) => withPatch(o, { ...patch, rule: undefined }));
    return { events, split: null };
  }
  const old = readEvent(series.master);
  let masterPatch: EventPatch = patch;
  let nextStart = old.start;
  let nextEnd = old.end;
  if (patch.start !== undefined || patch.end !== undefined) {
    const occ = baseTimes(old, key);
    const own = key === null ? null : overrideAt(series, key, ctx);
    const current = own ? readEvent(own) : occ;
    const start = patch.start ?? current.start;
    const end = patch.end ?? current.end;
    nextStart = translate(old.start, occ.start, start);
    nextEnd = sameFrame(start, end)
      ? shiftValue(nextStart, wallSeconds(end) - wallSeconds(start))
      : translate(old.start, occ.start, end);
    masterPatch = { ...patch, start: nextStart, end: nextEnd };
  }
  let master = withPatch(series.master, masterPatch);
  master = moveKeys(master, old, nextStart, ctx);
  const info = readEvent(master);
  if (!isRepeating(info)) return { events: [master], split: null };

  const delta = wallSeconds(nextStart) - wallSeconds(old.start);
  const set = recurrenceSetOf(info, ctx.zones, ctx.displayZone);
  const exDates = new Set(set.exDates);
  const overrides: ComponentNode[] = [];
  for (const o of series.overrides) {
    const oldKey = keyOf(o, old.start, ctx);
    if (oldKey === null) continue;
    const newKey = oldKey + delta;
    if (exDates.has(newKey) || !isInSet(set, newKey)) continue;
    const oi = readEvent(o);
    let e = o;
    if (delta !== 0 || !sameFrame(old.start, nextStart)) {
      e = withTime(e, 'RECURRENCE-ID', valueAtKey(newKey, nextStart));
      const kept =
        oi.recurrenceId !== null &&
        sameFrame(oi.start, oi.recurrenceId) &&
        wallSeconds(oi.start) === wallSeconds(oi.recurrenceId);
      if (kept) {
        const s = translate(oi.start, old.start, nextStart);
        const end = sameFrame(oi.start, nextStart)
          ? translate(oi.end, old.start, nextStart)
          : shiftValue(s, wallSeconds(nextEnd) - wallSeconds(nextStart));
        e = withTime(withoutProperty(withTime(e, 'DTSTART', s), 'DURATION'), 'DTEND', end);
      }
    }
    const fields: EventPatch = {};
    for (const f of TEXT_FIELDS) {
      const value = patch[f];
      if (value !== undefined && oi[f] === old[f]) Object.assign(fields, { [f]: value });
    }
    if (patch.reminders !== undefined && JSON.stringify(oi.reminders) === JSON.stringify(old.reminders)) {
      Object.assign(fields, { reminders: patch.reminders });
    }
    overrides.push(oldKey === key ? withPatch(e, { ...patch, rule: undefined }) : withPatch(e, fields));
  }
  // Skipped dates the rule no longer makes are dropped too.
  const keptExDates = info.exDates.filter((v) =>
    isInSet({ ...set, exDates: [] }, keyIn(v, info.start, ctx.zones, ctx.displayZone)),
  );
  if (keptExDates.length !== info.exDates.length) master = withTimeList(master, 'EXDATE', keptExDates);
  return { events: [master, ...overrides], split: null };
}

/** UNTIL for a rule that must end just before occurrence `key`. UTC when the start has a zone (RFC 5545). */
function untilBefore(key: number, start: TimeValue, ctx: SeriesContext): RuleUntil {
  if (start.kind === 'date') return { kind: 'date', date: addDays(fromLocalSeconds(key).slice(0, 10), -1) };
  if (!start.utc && !start.tzid)
    return { kind: 'date-time', dateTime: fromLocalSeconds(key - 1), utc: false };
  const instant = toInstant(key - 1, zoneOf(start, ctx.zones).zone, ctx.displayZone);
  return { kind: 'date-time', dateTime: fromLocalSeconds(instant), utc: true };
}

function withRules(event: ComponentNode, rules: readonly RecurrenceRule[]): ComponentNode {
  let e = withoutProperty(event, 'RRULE');
  rules.forEach((r, i) => {
    e =
      i === 0
        ? withProperty(e, propertyNode('RRULE', formatRule(r)))
        : { ...e, children: [...e.children, propertyNode('RRULE', formatRule(r))] };
  });
  return e;
}

export interface Split {
  /** The master, ending before the split. */
  readonly head: ComponentNode;
  /** Overrides that stay with the head. */
  readonly headOverrides: readonly ComponentNode[];
  /** The new series from the split on, with a new UID. */
  readonly tail: EventSeries;
}

/** Whether `key` is the series' first occurrence (a split there is the whole series). */
export function isFirstKey(series: EventSeries, key: number): boolean {
  if (!series.master) return true;
  return key <= wallSeconds(readEvent(series.master).start);
}

/**
 * Splits a repeating series at occurrence `key` (§8.2): the master's rule ends before it, and a new series with a
 * new UID starts there, taking the overrides, extra and skipped dates from there on. A COUNT is shared out.
 */
export function splitSeries(series: EventSeries, key: number, ctx: SeriesContext): Split {
  if (!series.master) throw new Error('The series has no master.');
  const master = series.master;
  const info = readEvent(master);
  const set = recurrenceSetOf(info, ctx.zones, ctx.displayZone);
  const until = untilBefore(key, info.start, ctx);
  const headRules = info.rules.map((r) => ({ ...r, count: null, until }));
  const tailRules = info.rules.map((r, i) => {
    if (r.count === null) return r;
    const used = expandRule(set.rules[i] ?? r, set.start, { from: set.start, to: key }).starts.length;
    return { ...r, count: Math.max(1, r.count - used) };
  });
  const before = (v: TimeValue) => keyIn(v, info.start, ctx.zones, ctx.displayZone) < key;
  let head = withRules(master, headRules);
  if (info.rDates.length) head = withTimeList(head, 'RDATE', info.rDates.filter(before));
  if (info.exDates.length) head = withTimeList(head, 'EXDATE', info.exDates.filter(before));

  const uid = ctx.makeUid();
  const startAtKey = valueAtKey(key, info.start);
  const endAtKey = shiftValue(info.end, key - wallSeconds(info.start));
  let tailMaster = withProperty(withRules(master, tailRules), propertyNode('UID', uid));
  tailMaster = withTime(withoutProperty(tailMaster, 'DURATION'), 'DTEND', endAtKey);
  tailMaster = withTime(tailMaster, 'DTSTART', startAtKey);
  for (const name of ['CREATED', 'DTSTAMP', 'LAST-MODIFIED', 'SEQUENCE'])
    tailMaster = withoutProperty(tailMaster, name);
  if (info.rDates.length)
    tailMaster = withTimeList(
      tailMaster,
      'RDATE',
      info.rDates.filter((v) => !before(v)),
    );
  if (info.exDates.length)
    tailMaster = withTimeList(
      tailMaster,
      'EXDATE',
      info.exDates.filter((v) => !before(v)),
    );
  const headOverrides: ComponentNode[] = [];
  const tailOverrides: ComponentNode[] = [];
  for (const o of series.overrides) {
    const k = keyOf(o, info.start, ctx);
    if (k !== null && k < key) headOverrides.push(o);
    else tailOverrides.push(withProperty(o, propertyNode('UID', uid)));
  }
  const tail: EventSeries = { uid, master: tailMaster, overrides: tailOverrides };
  return { head, headOverrides, tail };
}

/** This and Future Events (§8.2). At the first occurrence it is All Events. */
export function editFuture(
  series: EventSeries,
  key: number,
  patch: EventPatch,
  ctx: SeriesContext,
): SeriesChange {
  if (!series.master || isFirstKey(series, key)) return editAll(series, key, patch, ctx);
  const { head, headOverrides, tail } = splitSeries(series, key, ctx);
  const changed = editAll(tail, key, patch, ctx);
  const [tailMaster, ...tailOverrides] = changed.events;
  return {
    events: [head, ...headOverrides],
    split: { uid: tail.uid, master: tailMaster ?? null, overrides: tailOverrides },
  };
}

/** The UID property of a VEVENT. */
export function uidOf(event: ComponentNode): string {
  return property(event, 'UID')?.value.trim() ?? '';
}
