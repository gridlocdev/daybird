/**
 * Time zones (PRD §4.3). Offsets for IANA zones come from `Intl.DateTimeFormat`, probed once per zone and
 * year into a table of transitions; zones defined only by a file's VTIMEZONE use its STANDARD and DAYLIGHT
 * rules, expanded with the recurrence engine. Instants are UTC seconds since the epoch; wall-clock times are
 * local seconds (`dateTime.ts`).
 */
import { fromEpochDay, toEpochDay } from '../plainDate.ts';
import { SECONDS_PER_DAY } from './dateTime.ts';
import { expandRule, type RecurrenceRule } from './rrule.ts';
import { WINDOWS_ZONES } from './windowsZones.ts';

/** One STANDARD or DAYLIGHT part of a VTIMEZONE. */
export interface Observance {
  readonly kind: 'STANDARD' | 'DAYLIGHT';
  /** Local seconds, on the clock before the change (TZOFFSETFROM). */
  readonly start: number;
  readonly offsetFrom: number;
  readonly offsetTo: number;
  readonly rule: RecurrenceRule | null;
  /** Further onsets, local seconds. */
  readonly rdates: readonly number[];
  readonly name: string | null;
}

export type Zone =
  | { readonly kind: 'utc' }
  | { readonly kind: 'floating' }
  | { readonly kind: 'iana'; readonly id: string }
  | { readonly kind: 'custom'; readonly id: string; readonly observances: readonly Observance[] };

export const UTC: Zone = { kind: 'utc' };
export const FLOATING: Zone = { kind: 'floating' };

export function ianaZone(id: string): Zone {
  return { kind: 'iana', id };
}

const validIds = new Map<string, boolean>();

/** Whether the runtime knows `id` as an IANA zone. */
export function isIanaZone(id: string): boolean {
  let ok = validIds.get(id);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: id });
      ok = id.includes('/') || id === 'UTC' || id === 'GMT' || /^Etc\//.test(id);
    } catch {
      ok = false;
    }
    validIds.set(id, ok);
  }
  return ok;
}

/** The system's zone, as `Intl` reports it. */
export function systemZoneId(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The zone a TZID names (PRD §4.3): an IANA name as is, a Windows name through the CLDR table, a zone the
 * file defines, else null (the caller reads the time as floating and says so). Prefixed ids such as
 * `/mozilla.org/20050126_1/Europe/London` are read by their IANA tail.
 */
export function resolveTzid(tzid: string, fileZones: ReadonlyMap<string, Zone> = new Map()): Zone | null {
  const id = tzid.trim();
  if (isIanaZone(id)) return ianaZone(id);
  const windows = WINDOWS_ZONES[id];
  if (windows && isIanaZone(windows)) return ianaZone(windows);
  const own = fileZones.get(id);
  if (own) return own;
  if (id.startsWith('/')) {
    const parts = id.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const tail = parts.slice(i).join('/');
      if (isIanaZone(tail)) return ianaZone(tail);
    }
  }
  return null;
}

// ——— Offsets ———

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(id: string): Intl.DateTimeFormat {
  let f = formatters.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: id,
      hourCycle: 'h23',
      era: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(id, f);
  }
  return f;
}

function epochDayOf(year: number, month: number, day: number): number {
  return toEpochDay(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );
}

/** The offset `Intl` reports for `id` at `utc` (seconds), in seconds east of UTC. */
function intlOffset(id: string, utc: number): number {
  const parts: Record<string, string> = {};
  for (const p of formatter(id).formatToParts(utc * 1000)) parts[p.type] = p.value;
  let year = Number(parts.year);
  if (parts.era === 'BC' || parts.era === 'B') year = 1 - year;
  if (year < 1) return 0;
  const hour = Number(parts.hour) % 24;
  const local =
    epochDayOf(year, Number(parts.month), Number(parts.day)) * SECONDS_PER_DAY +
    hour * 3600 +
    Number(parts.minute) * 60 +
    Number(parts.second);
  return local - utc;
}

/** A zone's offsets over a span: `offsets[i]` applies from `at[i]` (UTC seconds); `base` before the first. */
interface Transitions {
  readonly base: number;
  readonly at: readonly number[];
  readonly offsets: readonly number[];
}

const PROBE_STEP = 6 * 3600;
const ianaYears = new Map<string, Transitions>();

function yearStartUtc(year: number): number {
  return epochDayOf(year, 1, 1) * SECONDS_PER_DAY;
}

function utcYear(utc: number): number {
  return Number(fromEpochDay(Math.floor(utc / SECONDS_PER_DAY)).slice(0, 4));
}

/** Finds each change of offset in `year` by probing every 6 hours, then narrowing to the second. */
function ianaTransitions(id: string, year: number): Transitions {
  const key = `${id} ${year}`;
  let t = ianaYears.get(key);
  if (t) return t;
  const start = yearStartUtc(year) - SECONDS_PER_DAY;
  const end = yearStartUtc(year + 1) + SECONDS_PER_DAY;
  const base = intlOffset(id, start);
  const at: number[] = [];
  const offsets: number[] = [];
  let previous = base;
  for (let probe = start + PROBE_STEP; probe <= end; probe += PROBE_STEP) {
    const offset = intlOffset(id, probe);
    if (offset === previous) continue;
    let lo = probe - PROBE_STEP;
    let hi = probe;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (intlOffset(id, mid) === previous) lo = mid;
      else hi = mid;
    }
    at.push(hi);
    offsets.push(offset);
    previous = offset;
  }
  t = { base, at, offsets };
  ianaYears.set(key, t);
  return t;
}

const customYears = new WeakMap<object, Map<number, Transitions>>();

/** Onsets of a VTIMEZONE's observances from the earliest to the end of `year`. */
function customTransitions(zone: { readonly observances: readonly Observance[] }, year: number): Transitions {
  let years = customYears.get(zone);
  if (!years) {
    years = new Map();
    customYears.set(zone, years);
  }
  const cached = years.get(year);
  if (cached) return cached;
  const windowStart = yearStartUtc(year) - SECONDS_PER_DAY;
  const windowEnd = yearStartUtc(year + 1) + SECONDS_PER_DAY;
  const onsets: { at: number; offset: number }[] = [];
  for (const o of zone.observances) {
    const locals = o.rule
      ? [...expandRule(o.rule, o.start, { from: o.start, to: windowEnd + o.offsetFrom + 1 }).starts]
      : [o.start];
    for (const r of o.rdates) if (r - o.offsetFrom < windowEnd) locals.push(r);
    for (const l of locals) onsets.push({ at: l - o.offsetFrom, offset: o.offsetTo });
  }
  onsets.sort((a, b) => a.at - b.at);
  const first = [...zone.observances].sort((a, b) => a.start - b.start)[0];
  let base = first?.offsetFrom ?? 0;
  const at: number[] = [];
  const offsets: number[] = [];
  for (const onset of onsets) {
    if (onset.at <= windowStart) base = onset.offset;
    else if (onset.at < windowEnd) {
      at.push(onset.at);
      offsets.push(onset.offset);
    }
  }
  const t = { base, at, offsets };
  years.set(year, t);
  return t;
}

function lookup(t: Transitions, utc: number): number {
  let offset = t.base;
  for (let i = 0; i < t.at.length; i++) {
    if ((t.at[i] ?? 0) > utc) break;
    offset = t.offsets[i] ?? offset;
  }
  return offset;
}

/**
 * The zone's offset at `utc` (seconds), in seconds east of UTC. Floating times use `displayZone`, the IANA id
 * times are shown in.
 */
export function offsetAt(zone: Zone, utc: number, displayZone: string): number {
  switch (zone.kind) {
    case 'utc':
      return 0;
    case 'floating':
      return lookup(ianaTransitions(displayZone, utcYear(utc)), utc);
    case 'iana':
      return lookup(ianaTransitions(zone.id, utcYear(utc)), utc);
    case 'custom':
      return lookup(customTransitions(zone, utcYear(utc)), utc);
  }
}

/** The wall-clock time (local seconds) in `zone` at `utc`. */
export function toLocal(utc: number, zone: Zone, displayZone: string): number {
  return utc + offsetAt(zone, utc, displayZone);
}

/**
 * The instant a wall-clock time in `zone` names (RFC 5545 §3.3.5). A time inside a spring-forward gap moves
 * forward by the gap; a time that happens twice at a fall-back takes the earlier.
 */
export function toInstant(local: number, zone: Zone, displayZone: string): number {
  if (zone.kind === 'utc') return local;
  const before = offsetAt(zone, local - SECONDS_PER_DAY, displayZone);
  const after = offsetAt(zone, local + SECONDS_PER_DAY, displayZone);
  const valid = [...new Set([before, after])]
    .map((o) => local - o)
    .filter((utc) => offsetAt(zone, utc, displayZone) === local - utc)
    .sort((a, b) => a - b);
  return valid[0] ?? local - before;
}

/** Every change of offset in `zone` during `year`: when (UTC seconds), from and to. */
export function transitionsIn(
  zone: Zone,
  year: number,
  displayZone: string,
): { at: number; from: number; to: number }[] {
  if (zone.kind === 'utc') return [];
  const t =
    zone.kind === 'custom'
      ? customTransitions(zone, year)
      : ianaTransitions(zone.kind === 'iana' ? zone.id : displayZone, year);
  const start = yearStartUtc(year);
  const end = yearStartUtc(year + 1);
  const out: { at: number; from: number; to: number }[] = [];
  let previous = t.base;
  t.at.forEach((at, i) => {
    const to = t.offsets[i] ?? previous;
    if (at >= start && at < end) out.push({ at, from: previous, to });
    previous = to;
  });
  return out;
}

/** The zone's short name at `utc` ("GMT", "BST", "GMT+1"), from `Intl`. */
export function zoneAbbreviation(id: string, utc: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'short' }).formatToParts(
    utc * 1000,
  );
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? id;
}

/** `+HHMM` (with seconds when they aren't zero) for an offset in seconds. */
export function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const abs = Math.abs(seconds);
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  const ss = abs % 60;
  return `${sign}${hh}${mm}${ss ? String(ss).padStart(2, '0') : ''}`;
}

/** Seconds east of UTC from `+HHMM` or `+HHMMSS`, or null. */
export function parseOffset(text: string): number | null {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(text.trim());
  if (!m) return null;
  const seconds = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0);
  return m[1] === '-' ? -seconds : seconds;
}
