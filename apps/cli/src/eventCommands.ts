/**
 * The commands that change events (PRD §16): `add`, `edit` and `delete`. A repeating event changes as a whole
 * unless `--occurrence` names one of its occurrences; a deleted event goes to the Trash (§7.7).
 */
import {
  allDayTimes,
  createEvent,
  deleteOccurrence,
  editOccurrence,
  findOccurrence,
  findSeries,
  isRepeating,
  readEvent,
  parseRule,
  addDays,
  type Calendar,
  type EditContext,
  type EventPatch,
  type Occurrence,
  type OccurrenceRef,
  type PlainDate,
  type RecurrenceRule,
  type Scope,
  type TimeValue,
  type Workspace,
} from '@daybird/core';
import { UserError, calendarNamed, changeFolder, defaultCalendar } from './folder.ts';
import { str, type CommandEnv, type Options } from './readCommands.ts';
import { endAfter, occurrenceKey, parseLength, parseWhen, timeValue, wallClock } from './times.ts';

const HOUR = 3600;
const DAY = 86_400;

function editContext(env: CommandEnv): EditContext {
  return { now: Math.floor(env.now / 1000), makeUid: () => crypto.randomUUID(), displayZone: env.zone };
}

/** The event's start and end from --start, --end, --duration and --all-day. `keep` is the length so far. */
function times(
  opts: Options,
  env: CommandEnv,
  keep: { seconds: number; days: number } | null,
): { start: TimeValue; end: TimeValue } {
  const startText = str(opts, 'start');
  if (!startText) throw new UserError('--start is needed.');
  const start = parseWhen(startText, '--start');
  const endText = str(opts, 'end');
  const durationText = str(opts, 'duration');
  if (endText && durationText) throw new UserError('Give --end or --duration, not both.');
  const end = endText ? parseWhen(endText, '--end') : null;
  const length = durationText ? parseLength(durationText) : null;

  if (start.kind === 'date' || opts['all-day'] === true) {
    const first: PlainDate = start.kind === 'date' ? start.date : start.dateTime.slice(0, 10);
    let last = first;
    if (end) last = end.kind === 'date' ? end.date : end.dateTime.slice(0, 10);
    else if (length !== null) {
      if (length % DAY !== 0) throw new UserError('An all-day event’s --duration is whole days, such as 2d.');
      last = addDays(first, length / DAY - 1);
    } else if (keep) last = addDays(first, Math.max(1, keep.days) - 1);
    if (last < first) throw new UserError('--end is before --start.');
    return allDayTimes(first, last);
  }
  const startValue = timeValue(start, env.zone);
  if (end) {
    if (end.kind === 'date') throw new UserError('--end needs a time too, as --start has one.');
    const endValue = timeValue(end, env.zone);
    if (endValue.kind === 'date-time' && startValue.kind === 'date-time' && !end.utc === !start.utc) {
      if (endValue.dateTime <= startValue.dateTime) throw new UserError('--end is not after --start.');
    }
    return { start: startValue, end: endValue };
  }
  const seconds = length ?? (keep && keep.seconds > 0 ? keep.seconds : HOUR);
  return { start: startValue, end: endAfter(startValue, seconds) };
}

function rule(opts: Options): RecurrenceRule | null | undefined {
  const text = str(opts, 'rrule');
  if (text === undefined) return undefined;
  if (text.trim().toLowerCase() === 'none' || text.trim() === '') return null;
  const parsed = parseRule(text.replace(/^RRULE:/i, ''));
  if (!parsed.ok) throw new UserError(`--rrule: ${parsed.message}`);
  return parsed.rule;
}

/** The text fields the options set; an empty value clears one. */
function textPatch(opts: Options): EventPatch {
  const patch: { -readonly [K in keyof EventPatch]: EventPatch[K] } = {};
  for (const name of ['title', 'location', 'notes', 'url'] as const) {
    const v = str(opts, name);
    if (v !== undefined) patch[name] = v;
  }
  return patch;
}

export async function addCommand(title: string, opts: Options, env: CommandEnv): Promise<void> {
  const when = times(opts, env, null);
  const repeat = rule(opts);
  const name = str(opts, 'calendar');
  const made = await changeFolder(env.folder, env.appVersion, (loaded) => {
    const calendar = name ? calendarNamed(loaded.workspace.calendars, name) : defaultCalendar(loaded);
    if (calendar.readOnly) throw new UserError(`${calendar.name} can’t be read, so nothing is added to it.`);
    const fields = { ...textPatch(opts), title, ...when, ...(repeat ? { rule: repeat } : {}) };
    const { workspace, ref } = createEvent(loaded.workspace, editContext(env), calendar.id, fields);
    return { workspace, result: { uid: ref.uid, calendar: calendar.name } };
  });
  if (env.json) env.out(`${JSON.stringify(made)}\n`);
  else env.out(`Added “${title}” to ${made.calendar}: ${made.uid}\n`);
}

interface Found {
  readonly calendar: Calendar;
  readonly occurrence: Occurrence;
  readonly ref: OccurrenceRef;
  readonly scope: Scope;
}

/** The event `uid`, or its occurrence `--occurrence` names. */
function findEvent(ws: Workspace, uid: string, opts: Options, env: CommandEnv): Found {
  const calendar = ws.calendars.find((c) => !c.readOnly && findSeries(c.document, uid));
  const series = calendar ? findSeries(calendar.document, uid) : null;
  if (!calendar || !series)
    throw new UserError(`No event ${uid}. \`daybird list --json\` shows each event’s uid.`);
  const master = series.master ? readEvent(series.master) : null;
  const repeating = master ? isRepeating(master) : false;
  const occurrenceText = str(opts, 'occurrence');
  if (!occurrenceText) {
    // The whole event, seen through its first occurrence.
    const first = master
      ? findOccurrence(calendar, uid, repeating ? startKey(master.start) : null, env.zone)
      : null;
    if (!first)
      throw new UserError(`${uid} has no occurrence of its own to change; name one with --occurrence.`);
    return { calendar, occurrence: first, ref: { calendarId: calendar.id, uid, key: null }, scope: 'all' };
  }
  if (!repeating) throw new UserError(`${uid} doesn’t repeat; leave out --occurrence.`);
  const key = occurrenceKey(parseWhen(occurrenceText, '--occurrence'));
  const occurrence = findOccurrence(calendar, uid, key, env.zone);
  if (!occurrence) throw new UserError(`${uid} has no occurrence at ${occurrenceText}.`);
  return { calendar, occurrence, ref: { calendarId: calendar.id, uid, key }, scope: 'this' };
}

/** The key of a series' first occurrence: its start on its own clock. */
function startKey(start: TimeValue): number {
  return occurrenceKey(
    start.kind === 'date' ? start : { kind: 'date-time', dateTime: start.dateTime, utc: start.utc },
  );
}

const TIME_OPTIONS = ['start', 'end', 'duration', 'all-day'];

export async function editCommand(uid: string, opts: Options, env: CommandEnv): Promise<void> {
  const repeat = rule(opts);
  const name = str(opts, 'calendar');
  const result = await changeFolder(env.folder, env.appVersion, (loaded) => {
    const ws = loaded.workspace;
    const found = findEvent(ws, uid, opts, env);
    const o = found.occurrence;
    const patch: { -readonly [K in keyof EventPatch]: EventPatch[K] } = { ...textPatch(opts) };
    if (TIME_OPTIONS.some((n) => opts[n] !== undefined)) {
      const ownStart = o.allDay
        ? (o.startDate ?? o.ownStart.slice(0, 10))
        : wallClock(o.start, env.zone).slice(0, 16);
      const withStart = opts.start === undefined ? { ...opts, start: ownStart } : opts;
      const days = o.startDate && o.endDate ? daysBetween(o.startDate, o.endDate) : 1;
      Object.assign(patch, times(withStart, env, { seconds: o.end - o.start, days }));
    }
    if (repeat !== undefined) {
      if (found.scope === 'this')
        throw new UserError('--rrule changes the whole event; leave out --occurrence.');
      patch.rule = repeat;
    }
    const target = name ? calendarNamed(ws.calendars, name) : found.calendar;
    if (target.readOnly) throw new UserError(`${target.name} can’t be read, so nothing is moved to it.`);
    if (Object.keys(patch).length === 0 && target === found.calendar)
      throw new UserError('Nothing to change: give --title, --start, --calendar or another option.');
    const edited = editOccurrence(ws, editContext(env), found.ref, patch, found.scope, target.id);
    return { workspace: edited.workspace, result: { uid: edited.ref.uid, calendar: target.name } };
  });
  if (env.json) env.out(`${JSON.stringify(result)}\n`);
  else env.out(`Changed ${result.uid} in ${result.calendar}.\n`);
}

function daysBetween(first: PlainDate, after: PlainDate): number {
  return Math.round((Date.parse(`${after}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / (DAY * 1000));
}

export async function deleteCommand(uid: string, opts: Options, env: CommandEnv): Promise<void> {
  const result = await changeFolder(env.folder, env.appVersion, (loaded) => {
    const found = findEvent(loaded.workspace, uid, opts, env);
    const workspace = deleteOccurrence(loaded.workspace, editContext(env), found.ref, found.scope);
    return { workspace, result: { uid, calendar: found.calendar.name, title: found.occurrence.title } };
  });
  if (env.json) env.out(`${JSON.stringify(result)}\n`);
  else
    env.out(
      `Moved “${result.title || 'New Event'}”${str(opts, 'occurrence') ? ` on ${str(opts, 'occurrence')}` : ''} from ${result.calendar} to the Trash.\n`,
    );
}
