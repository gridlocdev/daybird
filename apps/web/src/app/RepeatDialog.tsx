/**
 * The popover's Repeat field and its Custom… dialog (PRD §8.1). A rule the dialog can't show stays in words, with
 * Replace with a Simple Rule.
 */
import {
  REPEAT_PRESETS,
  customDefaults,
  customOf,
  describeRule,
  isLastWeekdayOf,
  ordinalOf,
  presetOf,
  presetRule,
  ruleFromCustom,
  weekday,
  whenOf,
  type CustomRepeat,
  type OccurrenceDetails,
  type PlainDate,
  type RecurrenceRule,
  type RepeatClock,
  type RepeatPreset,
  type Weekday,
} from '@daybird/core';
import { Dialog } from '@daybird/ui';
import type { AppController } from './controller.ts';
import { editEvent, editorDetails } from './eventActions.ts';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const ORDINALS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' };
const UNITS = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as const;

const clockOf = (app: AppController, d: OccurrenceDetails): RepeatClock => ({
  start: d.start,
  zone: d.zone,
  displayZone: app.displayZone,
});

const startOf = (d: OccurrenceDetails): PlainDate => whenOf(d.start, d.end).startDate;

/** The rule a simple replacement keeps: the same frequency, with no extra parts. */
function simpler(r: RecurrenceRule): RecurrenceRule | null {
  const preset: RepeatPreset =
    r.freq === 'DAILY'
      ? 'daily'
      : r.freq === 'MONTHLY'
        ? 'monthly'
        : r.freq === 'YEARLY'
          ? 'yearly'
          : 'weekly';
  return presetRule(preset, r);
}

/** The Repeat row of the popover. */
export function RepeatField({ app, d }: { readonly app: AppController; readonly d: OccurrenceDetails }) {
  const rule = d.rule;
  const editable = !d.complexRepeat && (!rule || customOf(rule, clockOf(app, d)) !== null);
  if (!editable)
    return (
      <div class="db-popover-row db-popover-repeat">
        <span>Repeat</span>
        <span class="db-popover-value">{d.repeat}</span>
        {rule && (
          <button
            type="button"
            class="db-button db-button-small"
            onClick={() => editEvent(app, { rule: simpler(rule) })}
          >
            Replace with a Simple Rule
          </button>
        )}
      </div>
    );
  const preset = presetOf(rule);
  return (
    <label class="db-popover-row">
      <span>Repeat</span>
      <select
        aria-label="Repeat"
        value={preset}
        onChange={(e) => {
          const v = e.currentTarget.value as RepeatPreset | 'custom' | 'edit';
          if (v === 'edit') {
            e.currentTarget.value = preset;
            const clock = clockOf(app, d);
            app.repeatDialog.value = (rule && customOf(rule, clock)) ?? customDefaults(startOf(d));
          } else if (v !== 'custom') editEvent(app, { rule: presetRule(v, rule) });
        }}
      >
        {REPEAT_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        {preset === 'custom' && rule && <option value="custom">{describeRule(rule, startOf(d))}</option>}
        <option value="edit">Custom…</option>
      </select>
    </label>
  );
}

/** The Custom… dialog: every N units, on which days, until when (§8.1). */
export function RepeatDialog({ app }: { readonly app: AppController }) {
  const c = app.repeatDialog.value;
  const d = editorDetails(app);
  if (!c || !d) return null;
  const clock = clockOf(app, d);
  const start = startOf(d);
  const set = (change: Partial<CustomRepeat>) => (app.repeatDialog.value = { ...c, ...change });
  const close = () => (app.repeatDialog.value = null);
  const ok = () => {
    const next = ruleFromCustom(c, clock, d.rule);
    close();
    editEvent(app, { rule: next });
  };
  const toggle = <T extends number>(list: readonly T[], x: T): T[] =>
    list.includes(x) ? (list.length > 1 ? list.filter((y) => y !== x) : [...list]) : [...list, x];
  const nth = ordinalOf(start);
  const day = weekday(start);
  const ordinalChoices = [nth, ...(nth === 4 && isLastWeekdayOf(start) ? [-1] : [])];
  const preview = describeRule(ruleFromCustom(c, clock, d.rule), start);
  return (
    <Dialog
      title="Custom Repeat"
      class="db-repeat-dialog"
      onClose={close}
      onSubmit={ok}
      actions={
        <>
          <button type="button" class="db-button" onClick={close}>
            Cancel
          </button>
          <button type="submit" class="db-button db-button-primary">
            OK
          </button>
        </>
      }
    >
      <div class="db-repeat-row">
        <label>
          Frequency{' '}
          <select
            data-autofocus
            value={c.freq}
            onChange={(e) => set({ freq: e.currentTarget.value as CustomRepeat['freq'] })}
          >
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
        </label>
        <label>
          Every{' '}
          <input
            type="number"
            min={1}
            max={999}
            aria-label="Interval"
            value={c.interval}
            onInput={(e) => {
              const n = Number(e.currentTarget.value);
              if (Number.isInteger(n) && n >= 1) set({ interval: n });
            }}
          />{' '}
          {UNITS[c.freq]}
          {c.interval === 1 ? '' : 's'}
        </label>
      </div>
      {c.freq === 'WEEKLY' && (
        <div class="db-segmented db-repeat-days" role="group" aria-label="On">
          {WEEKDAYS.map((name, i) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              aria-pressed={c.weekdays.includes(i as Weekday)}
              onClick={() => set({ weekdays: toggle(c.weekdays, i as Weekday) })}
            >
              {name.slice(0, 2)}
            </button>
          ))}
        </div>
      )}
      {c.freq === 'MONTHLY' && (
        <fieldset class="db-repeat-choices">
          <legend>On</legend>
          <label>
            <input
              type="radio"
              name="monthly"
              checked={c.monthly.kind === 'day'}
              onChange={() => set({ monthly: { kind: 'day', day: Number(start.slice(8, 10)) } })}
            />
            Day {c.monthly.kind === 'day' ? c.monthly.day : Number(start.slice(8, 10))}
          </label>
          {ordinalChoices.map((o) => (
            <label key={o}>
              <input
                type="radio"
                name="monthly"
                checked={c.monthly.kind === 'weekday' && c.monthly.ordinal === o}
                onChange={() => set({ monthly: { kind: 'weekday', ordinal: o, weekday: day } })}
              />
              The {ORDINALS[o]}{' '}
              {c.monthly.kind === 'weekday' && c.monthly.ordinal === o
                ? WEEKDAYS[c.monthly.weekday]
                : WEEKDAYS[day]}
            </label>
          ))}
          <label>
            <input
              type="radio"
              name="monthly"
              checked={c.monthly.kind === 'last'}
              onChange={() => set({ monthly: { kind: 'last' } })}
            />
            The last day
          </label>
        </fieldset>
      )}
      {c.freq === 'YEARLY' && (
        <>
          <div class="db-segmented db-repeat-months" role="group" aria-label="In">
            {MONTHS.map((name, i) => (
              <button
                key={name}
                type="button"
                aria-pressed={c.months.includes(i + 1)}
                onClick={() => set({ months: toggle(c.months, i + 1) })}
              >
                {name}
              </button>
            ))}
          </div>
          <label class="db-repeat-row">
            <input
              type="checkbox"
              checked={c.yearlyOn !== null}
              onChange={(e) =>
                set({ yearlyOn: e.currentTarget.checked ? { ordinal: nth, weekday: day } : null })
              }
            />
            On the {ORDINALS[c.yearlyOn?.ordinal ?? nth]} {WEEKDAYS[c.yearlyOn?.weekday ?? day]}
          </label>
        </>
      )}
      <fieldset class="db-repeat-choices">
        <legend>End</legend>
        <label>
          <input
            type="radio"
            name="end"
            checked={c.end.kind === 'never'}
            onChange={() => set({ end: { kind: 'never' } })}
          />
          Never
        </label>
        <label>
          <input
            type="radio"
            name="end"
            checked={c.end.kind === 'date'}
            onChange={() => set({ end: { kind: 'date', date: start } })}
          />
          On date
          {c.end.kind === 'date' && (
            <input
              type="date"
              aria-label="End repeat date"
              min={start}
              value={c.end.date}
              onChange={(e) => {
                const v = e.currentTarget.value as PlainDate;
                if (v) set({ end: { kind: 'date', date: v } });
              }}
            />
          )}
        </label>
        <label>
          <input
            type="radio"
            name="end"
            checked={c.end.kind === 'count'}
            onChange={() => set({ end: { kind: 'count', count: 10 } })}
          />
          After
          {c.end.kind === 'count' && (
            <input
              type="number"
              min={1}
              max={9999}
              aria-label="Times"
              value={c.end.count}
              onInput={(e) => {
                const n = Number(e.currentTarget.value);
                if (Number.isInteger(n) && n >= 1) set({ end: { kind: 'count', count: n } });
              }}
            />
          )}
          times
        </label>
      </fieldset>
      <p class="db-repeat-preview" aria-live="polite">
        {preview}
      </p>
    </Dialog>
  );
}
