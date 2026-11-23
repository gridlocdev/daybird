/**
 * The commands on the selected event (PRD §7.3, §7.4, §7.5, §12). They come before Previous and Next, so the
 * arrow keys move a selected event and move through time when nothing is selected.
 */
import type { CommandSpec } from '@daybird/ui';
import type { AppController } from './controller.ts';
import { deleteEvent, openEditor } from './eventActions.ts';
import {
  canChange,
  copyEvent,
  cutEvent,
  duplicateEvent,
  newEventHere,
  nudge,
  pasteEvent,
} from './moveActions.ts';

/** The right-click menu on an event, and on empty grid. */
export const EVENT_MENU = [
  'event.open',
  '|',
  'event.cut',
  'event.copy',
  'event.duplicate',
  '|',
  'event.delete',
] as const;
export const EMPTY_MENU = ['event.newHere', 'event.paste'] as const;

export function eventCommands(app: AppController): CommandSpec[] {
  const selected = () => app.selected.peek();
  const hasSelection = () => !!app.selected.value;
  const changeable = () => {
    const ref = app.selected.value;
    return !!ref && canChange(app, ref);
  };
  /** The arrow keys move events only where the view shows them on a grid. */
  const movable = () => changeable() && ['day', 'week', 'month'].includes(app.view.value);
  const onSelected = (fn: (ref: NonNullable<ReturnType<typeof selected>>) => void) => () => {
    const ref = selected();
    if (ref) fn(ref);
  };
  /** Up and down: 15 minutes (or `hours`) in Day and Week, a week in Month. */
  const upDown = (sign: -1 | 1, hours: boolean) => () =>
    nudge(app, app.view.peek() === 'month' ? { days: 7 * sign } : { minutes: sign * (hours ? 60 : 15) });
  return [
    {
      id: 'event.open',
      title: 'Open Event',
      description: 'Open the selected event’s details to change them.',
      group: 'Edit',
      shortcuts: ['enter'],
      keywords: 'edit details popover',
      enabled: hasSelection,
      run: onSelected((ref) => openEditor(app, ref)),
    },
    {
      id: 'event.cut',
      writes: true,
      title: 'Cut',
      description: 'Copy the selected event and move it to the Trash.',
      group: 'Edit',
      shortcuts: ['mod+x'],
      keywords: 'clipboard',
      enabled: changeable,
      run: onSelected((ref) => cutEvent(app, ref)),
    },
    {
      id: 'event.copy',
      title: 'Copy',
      description: 'Copy the selected event, to paste here or into another calendar app.',
      group: 'Edit',
      shortcuts: ['mod+c'],
      keywords: 'clipboard',
      enabled: hasSelection,
      run: onSelected((ref) => copyEvent(app, ref)),
    },
    {
      id: 'event.paste',
      writes: true,
      title: 'Paste',
      description: 'Add the copied event at the same time on the day shown.',
      group: 'Edit',
      shortcuts: ['mod+v'],
      keywords: 'clipboard',
      enabled: () => !!app.clipboard.value && !!app.defaultCalendar.value,
      run: () => pasteEvent(app, app.eventMenu.peek()?.target ?? null),
    },
    {
      id: 'event.duplicate',
      writes: true,
      title: 'Duplicate',
      description: 'Add a copy of the selected event at the same time, or a day later in Month.',
      group: 'Edit',
      shortcuts: ['mod+d'],
      keywords: 'copy clone',
      enabled: hasSelection,
      run: onSelected((ref) => duplicateEvent(app, ref)),
    },
    {
      id: 'event.newHere',
      writes: true,
      title: 'New Event Here',
      description: 'Add an event where you right-clicked.',
      group: 'Edit',
      hidden: true,
      enabled: () => !!app.eventMenu.value?.target,
      run: () => {
        const target = app.eventMenu.peek()?.target;
        app.eventMenu.value = null;
        if (target) newEventHere(app, target);
      },
    },
    {
      id: 'event.delete',
      writes: true,
      title: 'Delete Event',
      description: 'Move the selected event to the Trash.',
      group: 'Edit',
      shortcuts: ['delete', 'backspace'],
      keywords: 'remove trash',
      enabled: changeable,
      danger: true,
      run: onSelected((ref) => deleteEvent(app, ref)),
    },
    {
      id: 'event.deselect',
      title: 'Deselect Event',
      description: 'Clear the selection.',
      group: 'Edit',
      shortcuts: ['esc'],
      keywords: 'clear selection none',
      enabled: hasSelection,
      run: () => app.select(null),
    },
    {
      id: 'event.earlier',
      writes: true,
      title: 'Move Earlier',
      description: 'Move the selected event 15 minutes earlier, or a week in Month.',
      group: 'Edit',
      shortcuts: ['up'],
      keywords: 'move nudge',
      keysOnly: true,
      enabled: movable,
      run: upDown(-1, false),
    },
    {
      id: 'event.later',
      writes: true,
      title: 'Move Later',
      description: 'Move the selected event 15 minutes later, or a week in Month.',
      group: 'Edit',
      shortcuts: ['down'],
      keywords: 'move nudge',
      keysOnly: true,
      enabled: movable,
      run: upDown(1, false),
    },
    {
      id: 'event.hourEarlier',
      writes: true,
      title: 'Move an Hour Earlier',
      description: 'Move the selected event an hour earlier.',
      group: 'Edit',
      shortcuts: ['shift+up'],
      keywords: 'move nudge',
      keysOnly: true,
      enabled: movable,
      run: upDown(-1, true),
    },
    {
      id: 'event.hourLater',
      writes: true,
      title: 'Move an Hour Later',
      description: 'Move the selected event an hour later.',
      group: 'Edit',
      shortcuts: ['shift+down'],
      keywords: 'move nudge',
      keysOnly: true,
      enabled: movable,
      run: upDown(1, true),
    },
    {
      id: 'event.dayEarlier',
      writes: true,
      title: 'Move a Day Earlier',
      description: 'Move the selected event to the day before.',
      group: 'Edit',
      shortcuts: ['left'],
      keywords: 'move nudge',
      keysOnly: true,
      enabled: movable,
      run: () => nudge(app, { days: -1 }),
    },
    {
      id: 'event.dayLater',
      writes: true,
      title: 'Move a Day Later',
      description: 'Move the selected event to the day after.',
      group: 'Edit',
      shortcuts: ['right'],
      keywords: 'move nudge',
      keysOnly: true,
      enabled: movable,
      run: () => nudge(app, { days: 1 }),
    },
  ];
}
