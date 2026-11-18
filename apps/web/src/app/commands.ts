/**
 * Every command in the app (PRD §12). The keyboard, ⌘K, right-click menus, the menu bar, toolbar buttons,
 * the Keyboard Shortcuts window and docs/controls.md all come from this list.
 */
import type { View } from '@daybird/core';
import { CommandCatalog, type CommandSpec } from '@daybird/ui';
import type { AppController, DialogKind } from './controller.ts';

const VIEW_COMMANDS: readonly { view: View; title: string; key: string; n: number }[] = [
  { view: 'day', title: 'Day', key: 'd', n: 1 },
  { view: 'week', title: 'Week', key: 'w', n: 2 },
  { view: 'month', title: 'Month', key: 'm', n: 3 },
  { view: 'year', title: 'Year', key: 'y', n: 4 },
  { view: 'agenda', title: 'Agenda', key: 'a', n: 5 },
];

/** The command that opens each dialog: with that dialog open, its own shortcut still closes it. */
const DIALOG_COMMAND: Readonly<Record<DialogKind, string>> = {
  commands: 'help.commands',
  shortcuts: 'help.shortcuts',
  settings: 'app.settings',
};

export function buildCommands(app: AppController): CommandCatalog {
  const specs: CommandSpec[] = [
    // Only the desktop app opens folders on disk; the browser keeps its calendars in its own storage.
    ...(app.folders
      ? [
          {
            id: 'file.openFolder',
            title: 'Open Calendar Folder…',
            description: 'Use another folder of calendar files.',
            group: 'File',
            shortcuts: ['mod+o'],
            keywords: 'folder directory switch location',
            run: () => app.openFolder(),
          } satisfies CommandSpec,
        ]
      : []),
    {
      id: 'app.settings',
      title: 'Settings…',
      description: 'Change the appearance, the week and the time grid.',
      group: 'File',
      shortcuts: ['mod+,'],
      keywords: 'preferences options theme accent',
      global: true,
      run: () => app.toggle('settings'),
    },
    {
      id: 'edit.undo',
      title: 'Undo',
      description: 'Take back the last change.',
      group: 'Edit',
      shortcuts: ['mod+z'],
      keywords: 'revert back',
      enabled: () => app.canUndo.value,
      run: () => app.undo(),
    },
    {
      id: 'edit.redo',
      title: 'Redo',
      description: 'Make the last change you took back again.',
      group: 'Edit',
      shortcuts: ['mod+shift+z', 'mod+y'],
      keywords: 'again',
      enabled: () => app.canRedo.value,
      run: () => app.redo(),
    },
    ...VIEW_COMMANDS.map((v): CommandSpec => ({
      id: `view.${v.view}`,
      title: v.title,
      description: `Show the ${v.view === 'agenda' ? 'agenda list' : v.view}.`,
      group: 'View',
      shortcuts: [v.key, `mod+${v.n}`],
      keywords: 'view',
      checked: () => app.view.value === v.view,
      run: () => app.setView(v.view),
    })),
    {
      id: 'view.sidebar',
      title: 'Show Sidebar',
      description: 'Show or hide the mini month and the calendar list.',
      group: 'View',
      shortcuts: ['mod+alt+s'],
      keywords: 'calendars list panel hide',
      checked: () => app.settings.value.sidebarShown,
      run: () => app.toggleSidebar(),
    },
    {
      id: 'view.themeAuto',
      title: 'Match System Appearance',
      description: 'Use light or dark to match the system.',
      group: 'View',
      keywords: 'theme auto',
      checked: () => app.settings.value.theme === 'auto',
      run: () => app.setTheme('auto'),
    },
    {
      id: 'view.themeLight',
      title: 'Light Appearance',
      description: 'Always use the light appearance.',
      group: 'View',
      keywords: 'theme',
      checked: () => app.settings.value.theme === 'light',
      run: () => app.setTheme('light'),
    },
    {
      id: 'view.themeDark',
      title: 'Dark Appearance',
      description: 'Always use the dark appearance.',
      group: 'View',
      keywords: 'theme night',
      checked: () => app.settings.value.theme === 'dark',
      run: () => app.setTheme('dark'),
    },
    {
      id: 'go.today',
      title: 'Today',
      description: 'Show the range that holds today.',
      group: 'Go',
      shortcuts: ['t'],
      keywords: 'now',
      run: () => app.goToday(),
    },
    {
      id: 'go.previous',
      title: 'Previous',
      description: 'Show the previous day, week, month or year, by the view.',
      group: 'Go',
      shortcuts: ['left', 'k'],
      keywords: 'back earlier',
      run: () => app.step(-1),
    },
    {
      id: 'go.next',
      title: 'Next',
      description: 'Show the next day, week, month or year, by the view.',
      group: 'Go',
      shortcuts: ['right', 'j'],
      keywords: 'forward later',
      run: () => app.step(1),
    },
    {
      id: 'help.commands',
      title: 'Command Menu…',
      description: 'Find and run any command by typing part of its name.',
      group: 'Help',
      shortcuts: ['mod+k'],
      keywords: 'palette search actions',
      global: true,
      run: () => app.toggle('commands'),
    },
    {
      id: 'help.shortcuts',
      title: 'Keyboard Shortcuts',
      description: 'List every keyboard shortcut.',
      group: 'Help',
      shortcuts: ['mod+/'],
      keywords: 'keys help',
      global: true,
      run: () => app.toggle('shortcuts'),
    },
  ];
  const catalog = new CommandCatalog(specs);
  // With a dialog open, only the command that toggles that dialog (or opens another one) runs.
  catalog.gate = (c) => !app.blocked() || Object.values(DIALOG_COMMAND).includes(c.id);
  return catalog;
}
