import { Icon, PopupMenu, type CommandCatalog } from '@daybird/ui';
import type { Calendar } from '@daybird/core';
import type { AppController } from './controller.ts';
import { toggleCalendar } from './calendarActions.ts';

/** What the calendar menu offers, from the catalog (PRD §5.2). */
export const CALENDAR_MENU = [
  'calendar.show',
  'calendar.rename',
  'calendar.colour',
  'calendar.setDefault',
  '|',
  'calendar.delete',
];

/**
 * The sidebar's calendars (PRD §5.2): a checkbox in the calendar's colour shows or hides it on this device, ⋯ or
 * a right-click opens its menu, and + adds one. A calendar that couldn't be read is greyed, with the reason.
 */
export function CalendarList({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const hidden = new Set(app.settings.value.hiddenCalendars);
  const defaultId = app.defaultCalendar.value?.id;
  const menu = app.calendarMenu.value;
  const openMenu = (id: string, x: number, y: number) => {
    app.calendarMenu.value = { id, x, y };
  };
  const calendars = [...app.calendars.value].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div class="db-sidebar-head">
        <h2 class="db-sidebar-heading">Calendars</h2>
        <button
          type="button"
          class="db-icon-button db-small"
          aria-label="New Calendar"
          title="New Calendar"
          disabled={!app.session.value}
          onClick={() => catalog.run('calendar.new')}
        >
          <Icon name="plus" />
        </button>
      </div>
      <ul class="db-calendars" aria-label="Calendars">
        {calendars.map((c) => (
          <CalendarRow
            key={c.id}
            calendar={c}
            shown={!hidden.has(c.id)}
            isDefault={c.id === defaultId}
            menuOpen={menu?.id === c.id}
            onToggle={() => toggleCalendar(app, c.id)}
            onMenu={openMenu}
          />
        ))}
      </ul>
      {menu && (
        <PopupMenu
          label={`${app.calendars.value.find((c) => c.id === menu.id)?.name ?? ''} menu`}
          catalog={catalog}
          items={CALENDAR_MENU}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            app.calendarMenu.value = null;
          }}
        />
      )}
    </>
  );
}

function CalendarRow(props: {
  readonly calendar: Calendar;
  readonly shown: boolean;
  readonly isDefault: boolean;
  readonly menuOpen: boolean;
  readonly onToggle: () => void;
  readonly onMenu: (id: string, x: number, y: number) => void;
}) {
  const c = props.calendar;
  const problem = c.error?.message;
  return (
    <li
      class={`db-calendar-row${c.readOnly ? ' db-unreadable' : ''}`}
      title={problem ? `Couldn’t read ${c.id}: ${problem}` : c.id}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu(c.id, e.clientX, e.clientY);
      }}
    >
      <label class="db-calendar-label">
        <input
          type="checkbox"
          class="db-calendar-check"
          style={{ '--db-cal': c.color }}
          checked={props.shown}
          onChange={props.onToggle}
        />
        <span class="db-calendar-name">{c.name}</span>
      </label>
      {props.isDefault && <span class="db-calendar-default">Default</span>}
      <button
        type="button"
        class="db-icon-button db-small db-calendar-more"
        aria-label={`${c.name} options`}
        aria-haspopup="menu"
        aria-expanded={props.menuOpen}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          props.onMenu(c.id, r.left, r.bottom + 2);
        }}
      >
        <Icon name="dots" />
      </button>
    </li>
  );
}
