/** What the Keyboard Shortcuts window lists (PRD §12): every command with a key, plus keys that aren't commands. */
import {
  COMMAND_GROUPS,
  eventLabel,
  isModifierKey,
  type CommandCatalog,
  type CommandGroup,
  type Shortcut,
  type ShortcutEvent,
} from '@daybird/ui';

export interface ShortcutLine {
  readonly title: string;
  /** Each way to press it; a way is one or more keys pressed in turn. */
  readonly keys: readonly (readonly string[])[];
}

export interface ShortcutGroup {
  readonly title: string;
  readonly lines: readonly ShortcutLine[];
}

const GROUP_TITLES: Record<CommandGroup, string> = {
  File: 'App',
  Edit: 'Editing',
  View: 'Views',
  Go: 'Moving through time',
  Help: 'Help',
};

/** Keys handled outside the catalog: in lists and dialogs, and Escape everywhere. */
function extras(mac: boolean): Partial<Record<CommandGroup, ShortcutLine[]>> {
  return {
    Help: [
      {
        title: 'Next / previous command in the command menu',
        keys: mac ? [['↓'], ['↑'], ['⇥'], ['⇧⇥']] : [['Down'], ['Up'], ['Tab'], ['Shift+Tab']],
      },
      { title: 'Close a window or menu', keys: [[mac ? '⎋' : 'Esc']] },
    ],
  };
}

export function shortcutGroups(catalog: CommandCatalog, mac: boolean): ShortcutGroup[] {
  const more = extras(mac);
  return COMMAND_GROUPS.map((group) => {
    const lines: ShortcutLine[] = catalog.all
      .filter((c) => c.group === group && c.sequences.length > 0)
      .map((c) => ({
        title:
          c.title.replace(/…$/, '') +
          (c.id.startsWith('event.') && c.keysOnly ? ', with an event selected' : ''),
        keys: c.sequences.map((_, i) => catalog.keys({ ...c, sequences: [c.sequences[i]!] }, mac)),
      }));
    return { title: GROUP_TITLES[group], lines: [...lines, ...(more[group] ?? [])] };
  }).filter((g) => g.lines.length > 0);
}

/** The finder's answer to the keys pressed so far: the keys as labels, and what they run. */
export interface FoundKey {
  readonly keys: readonly string[];
  /** The commands' titles, "No command", or a prompt for the second key of a sequence. */
  readonly text: string;
  readonly none: boolean;
  /** Set while the keys so far are the first of a two-key sequence: pass it back with the next key. */
  readonly pending: { readonly first: Shortcut; readonly label: string } | null;
}

/**
 * Press a shortcut (PRD §12): what a key press runs, read from the same catalog the keyboard uses. A
 * modifier pressed on its own changes nothing (null). It doesn't care where focus is or whether the
 * command is on right now: it says what the key is for.
 */
export function findKey(
  catalog: CommandCatalog,
  e: ShortcutEvent,
  pending: FoundKey['pending'],
  mac: boolean,
): FoundKey | null {
  if (isModifierKey(e)) return null;
  const label = eventLabel(e, mac);
  const keys = pending ? [pending.label, label] : [label];
  const found = catalog.lookup(e, pending?.first ?? null, mac);
  if (found?.kind === 'wait')
    return { keys, text: 'Press the second key…', none: false, pending: { first: found.first, label } };
  if (found?.kind === 'run')
    return {
      keys,
      text: found.commands.map((c) => c.title.replace(/…$/, '')).join(' / '),
      none: false,
      pending: null,
    };
  return { keys, text: 'No command', none: true, pending: null };
}
