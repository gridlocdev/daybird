/**
 * The popover's reminders (PRD §9): up to five, each a choice from the menu or Custom… (an amount of minutes,
 * hours, days or weeks before). A reminder the menu can't show (at a set time, or from the end) stays in words
 * and can be removed.
 */
import { useState } from 'preact/hooks';
import {
  MAX_REMINDERS,
  customReminder,
  firstReminder,
  reminderAmount,
  reminderChoices,
  reminderWords,
  timeLabel,
  type OccurrenceDetails,
  type Reminder,
  type ReminderFormat,
  type ReminderUnit,
} from '@daybird/core';
import { Icon } from '@daybird/ui';
import type { AppController } from './controller.ts';
import { editEvent } from './eventActions.ts';
import { HOUR12 } from './eventParts.tsx';

const UNITS: readonly ReminderUnit[] = ['minutes', 'hours', 'days', 'weeks'];
const CUSTOM = 'custom';

const sameReminder = (a: Reminder, b: Reminder) =>
  a.kind === 'before' && b.kind === 'before' && a.seconds === b.seconds && !a.fromEnd && !b.fromEnd;

/** How reminders are put in words in this window. */
export function reminderFormat(app: AppController): ReminderFormat {
  const hour12 = HOUR12[app.settings.value.timeFormat];
  return {
    nine: timeLabel(9 * 3600, app.locale, 'UTC', hour12),
    dateTime: (utc) =>
      new Intl.DateTimeFormat(app.locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: app.displayZone,
        ...(hour12 === undefined ? {} : { hour12 }),
      }).format(utc * 1000),
  };
}

export function ReminderField({ app, d }: { readonly app: AppController; readonly d: OccurrenceDetails }) {
  const list = d.occurrence.reminders;
  const allDay = d.occurrence.allDay;
  const choices = reminderChoices(allDay);
  const format = reminderFormat(app);
  // The row whose Custom… amount is open, though its value may still match a menu item.
  const [customRow, setCustomRow] = useState<number | null>(null);
  const set = (next: readonly Reminder[]) => editEvent(app, { reminders: next });
  const replace = (i: number, r: Reminder) => set(list.map((x, j) => (j === i ? r : x)));
  const remove = (i: number) => {
    setCustomRow(null);
    set(list.filter((_, j) => j !== i));
  };
  return (
    <div class="db-popover-reminders" role="group" aria-label="Reminders">
      {list.map((r, i) => {
        const n = i + 1;
        const preset = choices.findIndex((c) => sameReminder(c, r));
        const custom = r.kind === 'before' && !r.fromEnd && (preset < 0 || customRow === i);
        const amount = r.kind === 'before' ? reminderAmount(r.seconds) : null;
        return (
          <div class="db-popover-row" key={`${i}-${JSON.stringify(r)}`}>
            <span>{i === 0 ? 'Reminder' : ''}</span>
            {r.kind === 'at' || r.fromEnd ? (
              <span class="db-popover-value">{reminderWords(r, allDay, format)}</span>
            ) : (
              <select
                aria-label={`Reminder ${n}`}
                value={custom ? CUSTOM : String(preset)}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  if (v === CUSTOM) setCustomRow(i);
                  else {
                    setCustomRow(null);
                    replace(i, choices[Number(v)]!);
                  }
                }}
              >
                {choices.map((c, j) => (
                  <option key={j} value={String(j)}>
                    {reminderWords(c, allDay, format)}
                  </option>
                ))}
                <option value={CUSTOM}>Custom…</option>
              </select>
            )}
            {custom && amount && (
              <span class="db-popover-custom">
                <input
                  type="number"
                  min={0}
                  max={999}
                  aria-label={`Reminder ${n} amount`}
                  value={amount.amount}
                  onInput={(e) => {
                    const v = Number(e.currentTarget.value);
                    if (Number.isInteger(v) && v >= 0 && v <= 999) replace(i, customReminder(v, amount.unit));
                  }}
                />
                <select
                  aria-label={`Reminder ${n} unit`}
                  value={amount.unit}
                  onChange={(e) =>
                    replace(i, customReminder(amount.amount, e.currentTarget.value as ReminderUnit))
                  }
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u} before
                    </option>
                  ))}
                </select>
              </span>
            )}
            <button
              type="button"
              class="db-icon-button"
              aria-label={`Remove reminder ${n}`}
              onClick={() => remove(i)}
            >
              <Icon name="x" />
            </button>
          </div>
        );
      })}
      {list.length < MAX_REMINDERS && (
        <div class="db-popover-row">
          <span>{list.length === 0 ? 'Reminder' : ''}</span>
          <button
            type="button"
            class="db-button db-button-small"
            onClick={() => set([...list, firstReminder(allDay)])}
          >
            Add Reminder
          </button>
        </div>
      )}
    </div>
  );
}
