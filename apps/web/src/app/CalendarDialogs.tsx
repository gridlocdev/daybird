import { useState } from 'preact/hooks';
import { PALETTE, seriesOf } from '@daybird/core';
import { Dialog, radioKeys, takeStop } from '@daybird/ui';
import type { AppController } from './controller.ts';
import {
  closeCalendarDialog,
  deleteCalendar,
  newCalendar,
  recolourCalendar,
  renameCalendar,
  targetCalendar,
} from './calendarActions.ts';

const HEXES = PALETTE.map((p) => p.hex);

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** New, Rename, Colour and Delete for a calendar (PRD §5.2). */
export function CalendarDialogs({ app }: { readonly app: AppController }) {
  const kind = app.calendarDialog.value;
  const calendar = kind === 'new' ? null : targetCalendar(app);
  const close = () => closeCalendarDialog(app);
  if (!kind || (kind !== 'new' && !calendar)) return null;
  switch (kind) {
    case 'new':
      return (
        <NameDialog
          title="New Calendar"
          action="Add"
          initial=""
          onClose={close}
          onDone={(name) => {
            close();
            void newCalendar(app, name);
          }}
        />
      );
    case 'rename':
      return (
        <NameDialog
          title={`Rename ${calendar!.name}`}
          action="Rename"
          initial={calendar!.name}
          onClose={close}
          onDone={(name) => {
            close();
            renameCalendar(app, calendar!.id, name);
          }}
        />
      );
    case 'colour': {
      const chosen = calendar!.color.toLowerCase();
      // A colour from outside the palette (set in another app) leaves the first swatch as the tab stop.
      const stop = HEXES.includes(chosen) ? chosen : HEXES[0];
      return (
        <Dialog
          title={`Colour of ${calendar!.name}`}
          onClose={close}
          actions={
            <button type="button" class="db-button" onClick={close}>
              Done
            </button>
          }
        >
          <div
            class="db-swatches db-calendar-swatches"
            role="radiogroup"
            aria-label="Colour"
            data-roving
            onKeyDown={(e) => radioKeys(e, HEXES, chosen, (hex) => recolourCalendar(app, calendar!.id, hex))}
          >
            {PALETTE.map((p) => (
              <button
                key={p.hex}
                type="button"
                role="radio"
                class="db-swatch"
                style={{ '--db-swatch': p.hex }}
                aria-checked={chosen === p.hex}
                aria-label={p.name}
                title={p.name}
                tabIndex={stop === p.hex ? 0 : -1}
                ref={stop === p.hex ? takeStop : undefined}
                data-autofocus={stop === p.hex ? true : undefined}
                onClick={() => {
                  recolourCalendar(app, calendar!.id, p.hex);
                  close();
                }}
              />
            ))}
          </div>
        </Dialog>
      );
    }
    case 'delete': {
      const count = seriesOf(calendar!.document).length;
      return (
        <Dialog
          title={`Delete ${calendar!.name}?`}
          onClose={close}
          onSubmit={() => {
            close();
            void deleteCalendar(app, calendar!.id);
          }}
          actions={
            <>
              <button type="button" class="db-button" onClick={close} data-autofocus>
                Cancel
              </button>
              <button type="submit" class="db-button db-button-danger">
                Delete
              </button>
            </>
          }
        >
          <p>
            {calendar!.name} and its {plural(count, 'event')} move to the Trash, where you can restore them
            for 30 days.
          </p>
        </Dialog>
      );
    }
  }
}

function NameDialog(props: {
  readonly title: string;
  readonly action: string;
  readonly initial: string;
  readonly onClose: () => void;
  readonly onDone: (name: string) => void;
}) {
  const [name, setName] = useState(props.initial);
  return (
    <Dialog
      title={props.title}
      onClose={props.onClose}
      onSubmit={() => props.onDone(name)}
      actions={
        <>
          <button type="button" class="db-button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="db-button db-button-primary">
            {props.action}
          </button>
        </>
      }
    >
      <label class="db-field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          placeholder="Untitled"
          data-autofocus
          onInput={(e) => setName(e.currentTarget.value)}
          ref={(el) => {
            if (!el || el.dataset.selected) return;
            el.dataset.selected = '1';
            el.select();
          }}
        />
      </label>
    </Dialog>
  );
}
