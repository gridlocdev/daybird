/** Search, the Trash, Import and Export (PRD §7.7, §10, §11) as commands. */
import type { CommandSpec } from '@daybird/ui';
import { targetCalendar } from './calendarActions.ts';
import type { AppController } from './controller.ts';
import { exportAll, exportCalendar, importFile } from './importExport.ts';
import { focusSearch } from './searchActions.ts';
import { showTrash, trashCount } from './trashActions.ts';

export function fileCommands(app: AppController): CommandSpec[] {
  const ready = () => !!app.session.value;
  return [
    {
      id: 'file.import',
      writes: true,
      title: 'Import…',
      description: 'Add the events of an .ics file to a calendar.',
      group: 'File',
      shortcuts: ['mod+shift+i'],
      keywords: 'ics open add events file',
      enabled: ready,
      run: () => void importFile(app),
    },
    {
      id: 'calendar.export',
      title: 'Export Calendar…',
      description: 'Save a copy of a calendar’s .ics file: the one whose menu is open, else the default one.',
      group: 'File',
      keywords: 'save copy ics backup download',
      enabled: () => !!targetCalendar(app) && !targetCalendar(app)?.error,
      run: () => {
        const c = targetCalendar(app);
        app.calendarMenu.value = null;
        if (c) exportCalendar(app, c);
      },
    },
    {
      id: 'file.exportAll',
      title: 'Export All…',
      description: 'Save a .zip of every calendar file.',
      group: 'File',
      keywords: 'save copy zip backup download calendars',
      enabled: ready,
      run: () => exportAll(app),
    },
    {
      id: 'edit.search',
      title: 'Search',
      description: 'Find events by title, place or notes.',
      group: 'Edit',
      shortcuts: ['mod+f', '/'],
      keywords: 'find filter look',
      enabled: ready,
      run: () => focusSearch(),
    },
    {
      id: 'view.trash',
      title: 'Show Trash',
      description: 'See deleted events and calendars, and restore them.',
      group: 'View',
      keywords: 'deleted restore bin recycle',
      checked: () => app.trashShown.value,
      enabled: ready,
      run: () => showTrash(app, !app.trashShown.peek()),
    },
    {
      id: 'trash.empty',
      writes: true,
      title: 'Empty Trash…',
      description: 'Delete everything in the Trash for good.',
      group: 'File',
      keywords: 'delete permanently clear bin',
      offBecause: () => (trashCount(app) > 0 ? null : 'The Trash is empty.'),
      run: () => {
        app.trashMenu.value = null;
        app.trashQuestion.value = { kind: 'empty' };
      },
    },
  ];
}
