import { describe, expect, it, vi } from 'vitest';
import {
  CommandCatalog,
  SEQUENCE_MS,
  CAPTURE_IDLE_MS,
  captureKeys,
  eventLabel,
  filterEntries,
  formatSequence,
  isSubmitKey,
  isUndoKey,
  listenForKeys,
  listStep,
  parseSequence,
  sequenceAccelerator,
  type CommandSpec,
  type ShortcutEvent,
} from '../src/index.ts';

const key = (e: Partial<ShortcutEvent>): ShortcutEvent => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...e,
});

function catalog(extra: CommandSpec[] = []) {
  const ran: string[] = [];
  const spec = (id: string, shortcuts: string[], more: Partial<CommandSpec> = {}): CommandSpec => ({
    id,
    title: id,
    description: id,
    group: 'Edit',
    shortcuts,
    run: () => void ran.push(id),
    ...more,
  });
  const c = new CommandCatalog([
    spec('menu', ['mod+k', 'mod+p'], { global: true, group: 'View' }),
    spec('complete', ['space']),
    spec('edit', ['enter']),
    spec('undo', ['mod+z'], { global: true, group: 'Edit' }),
    spec('redo', ['mod+shift+z', 'mod+y'], { global: true, group: 'Edit' }),
    spec('shortcuts', ['?', 'mod+/'], { group: 'Help' }),
    spec('inbox', ['g i'], { group: 'Go' }),
    spec('today', ['g t'], { group: 'Go' }),
    spec('down', ['down', 'j'], { group: 'Edit' }),
    spec('extend', ['shift+down'], { group: 'Edit' }),
    ...extra,
  ]);
  return { c, ran };
}

const spec1 = (id: string, shortcuts: string[]): CommandSpec => ({
  id,
  title: id,
  description: id,
  group: 'Edit',
  shortcuts,
  run: () => undefined,
});

const id = (r: ReturnType<CommandCatalog['forEvent']>) =>
  r?.kind === 'run' ? r.command.id : (r?.kind ?? null);

describe('shortcuts', () => {
  it('mod is ⌘ on a Mac and Ctrl elsewhere', () => {
    const { c } = catalog();
    expect(id(c.forEvent(key({ key: 'k', metaKey: true }), 'list', 0, true))).toBe('menu');
    expect(id(c.forEvent(key({ key: 'k', ctrlKey: true }), 'list', 0, true))).toBeNull();
    expect(id(c.forEvent(key({ key: 'k', ctrlKey: true }), 'list', 0, false))).toBe('menu');
  });

  it('⌘Enter submits a dialog on a Mac, Ctrl+Enter elsewhere; plain or Shift+Enter does not', () => {
    expect(isSubmitKey(key({ key: 'Enter', metaKey: true }), true)).toBe(true);
    expect(isSubmitKey(key({ key: 'Enter', ctrlKey: true }), false)).toBe(true);
    expect(isSubmitKey(key({ key: 'Enter', ctrlKey: true }), true)).toBe(false);
    expect(isSubmitKey(key({ key: 'Enter' }), true)).toBe(false);
    expect(isSubmitKey(key({ key: 'Enter', metaKey: true, shiftKey: true }), true)).toBe(false);
  });

  it('⌘Z, ⇧⌘Z and ⌘Y are the undo keys on a Mac, with Ctrl elsewhere; plain Z or ⌥⌘Z are not', () => {
    expect(isUndoKey(key({ key: 'z', code: 'KeyZ', metaKey: true }), true)).toBe(true);
    expect(isUndoKey(key({ key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(isUndoKey(key({ key: 'y', code: 'KeyY', ctrlKey: true }), false)).toBe(true);
    expect(isUndoKey(key({ key: 'z', code: 'KeyZ', ctrlKey: true }), true)).toBe(false);
    expect(isUndoKey(key({ key: 'z', code: 'KeyZ' }), true)).toBe(false);
    expect(isUndoKey(key({ key: 'Ω', code: 'KeyZ', metaKey: true, altKey: true }), true)).toBe(false);
  });

  it('extra modifiers stop a match; Shift is ignored for symbols such as ?', () => {
    const { c } = catalog();
    expect(id(c.forEvent(key({ key: 'z', metaKey: true, shiftKey: true }), 'list', 0, true))).toBe('redo');
    expect(id(c.forEvent(key({ key: 'ArrowDown', shiftKey: true }), 'list', 0, true))).toBe('extend');
    expect(id(c.forEvent(key({ key: 'j', altKey: true }), 'list', 0, true))).toBeNull();
    expect(id(c.forEvent(key({ key: '?', shiftKey: true, code: 'Slash' }), 'list', 0, true))).toBe(
      'shortcuts',
    );
  });

  it('plain keys only count in the list; global chords work in text fields', () => {
    const { c } = catalog();
    expect(id(c.forEvent(key({ key: ' ' }), 'text', 0, true))).toBeNull();
    expect(id(c.forEvent(key({ key: 'z', metaKey: true }), 'text', 0, true))).toBe('undo');
    expect(id(c.forEvent(key({ key: ' ' }), 'control', 0, true))).toBeNull();
    expect(id(c.forEvent(key({ key: 'Enter' }), 'control', 0, true))).toBeNull();
    expect(id(c.forEvent(key({ key: 'j' }), 'control', 0, true))).toBe('down');
    expect(id(c.forEvent(key({ key: ' ' }), 'list', 0, true))).toBe('complete');
  });

  it('two-key shortcuts wait for the second key, for a while', () => {
    const { c } = catalog();
    expect(id(c.forEvent(key({ key: 'g' }), 'list', 0, true))).toBe('wait');
    expect(id(c.forEvent(key({ key: 't' }), 'list', 100, true))).toBe('today');
    expect(id(c.forEvent(key({ key: 'g' }), 'list', 1000, true))).toBe('wait');
    expect(id(c.forEvent(key({ key: 'i' }), 'list', 1000 + SEQUENCE_MS + 1, true))).toBeNull();
    expect(id(c.forEvent(key({ key: 'g' }), 'text', 0, true))).toBeNull();
  });

  it('a pending first key is dropped when focus moves into a text field', () => {
    const { c } = catalog();
    expect(id(c.forEvent(key({ key: 'g' }), 'list', 0, true))).toBe('wait');
    expect(id(c.forEvent(key({ key: 'i' }), 'text', 100, true))).toBeNull();
  });

  it('digit keys work on layouts that need Shift to type a digit (AZERTY)', () => {
    const { c } = catalog([spec1('p1', ['1']), spec1('p3', ['3'])]);
    expect(id(c.forEvent(key({ key: '&', code: 'Digit1' }), 'list', 0, true))).toBe('p1');
    expect(id(c.forEvent(key({ key: '"', code: 'Digit3' }), 'list', 0, false))).toBe('p3');
    expect(id(c.forEvent(key({ key: '1', code: 'Digit1', shiftKey: true }), 'list', 0, true))).toBe('p1');
    // US Shift+1 types ! and is not 1.
    expect(id(c.forEvent(key({ key: '!', code: 'Digit1', shiftKey: true }), 'list', 0, true))).toBeNull();
  });

  it('are shown with the right key caps, and only single chords go in menus', () => {
    expect(formatSequence(parseSequence('mod+shift+z'), true)).toEqual(['⇧⌘Z']);
    expect(formatSequence(parseSequence('mod+shift+z'), false)).toEqual(['Ctrl+Shift+Z']);
    expect(formatSequence(parseSequence('g i'), true)).toEqual(['G', 'I']);
    expect(formatSequence(parseSequence('backspace'), true)).toEqual(['⌫']);
    expect(sequenceAccelerator(parseSequence('mod+k'))).toBe('CmdOrCtrl+K');
    expect(sequenceAccelerator(parseSequence('shift+down'))).toBe('Shift+Down');
    expect(sequenceAccelerator(parseSequence('g i'))).toBeNull();
  });
});

describe('the catalog', () => {
  it('runs enabled commands through the gate and keeps 5 recents', () => {
    let open = true;
    const { c, ran } = catalog([
      {
        id: 'off',
        title: 'Off',
        description: 'Off',
        group: 'Edit',
        run: () => undefined,
        enabled: () => false,
      },
    ]);
    expect(c.run('off')).toBe(false);
    c.gate = () => open;
    open = false;
    expect(c.run('undo')).toBe(false);
    open = true;
    for (const x of ['undo', 'redo', 'inbox', 'today', 'down', 'extend', 'undo']) c.run(x);
    expect(ran).toEqual(['undo', 'redo', 'inbox', 'today', 'down', 'extend', 'undo']);
    expect(c.recentIds).toEqual(['undo', 'extend', 'down', 'today', 'inbox']);
  });

  it('turns off commands that write while the folder is read-only, and says why', () => {
    let why: string | null = 'Read-only.';
    const spec = (id: string, writes: boolean): CommandSpec => ({
      id,
      title: id,
      description: id,
      group: 'Edit',
      writes,
      run: () => undefined,
    });
    const c = new CommandCatalog([spec('add', true), spec('look', false)]);
    c.readOnly = () => why;
    const add = c.get('add')!;
    const look = c.get('look')!;
    expect([c.isEnabled(add), c.whyDisabled(add)]).toEqual([false, 'Read-only.']);
    expect([c.isEnabled(look), c.whyDisabled(look)]).toEqual([true, null]);
    expect(c.run('add')).toBe(false);
    why = null;
    expect([c.isEnabled(add), c.whyDisabled(add)]).toEqual([true, null]);
  });

  it("turns off a command whose own reason says so, and the folder's reason comes first", () => {
    let empty: string | null = 'The Trash is empty.';
    const c = new CommandCatalog([
      {
        id: 'empty',
        title: 'Empty',
        description: 'Empty',
        group: 'File',
        writes: true,
        offBecause: () => empty,
        run: () => undefined,
      },
    ]);
    const cmd = c.get('empty')!;
    expect([c.isEnabled(cmd), c.whyDisabled(cmd)]).toEqual([false, 'The Trash is empty.']);
    expect(c.run('empty')).toBe(false);
    c.readOnly = () => 'Read-only.';
    expect(c.whyDisabled(cmd)).toBe('Read-only.');
    c.readOnly = () => null;
    empty = null;
    expect([c.isEnabled(cmd), c.whyDisabled(cmd)]).toEqual([true, null]);
  });

  it('refuses duplicate ids', () => {
    expect(
      () =>
        new CommandCatalog(
          [1, 2].map(() => ({
            id: 'x',
            title: 'x',
            description: 'x',
            group: 'Edit' as const,
            run: () => undefined,
          })),
        ),
    ).toThrow();
  });
});

describe('the command menu', () => {
  const entries = [
    { id: 'today', title: 'Go to Today', group: 'Go' },
    { id: 'inbox', title: 'Go to Inbox Calendar', group: 'Go' },
    { id: 'new', title: 'New Event', group: 'File' },
  ];

  const ids = (q: string, recent?: string[]) => filterEntries(entries, q, recent).map((e) => e.id);

  it('matches every word and puts recent commands first', () => {
    expect(ids('go in')).toEqual(['inbox']);
    expect(ids('file')).toEqual(['new']);
    expect(ids('', ['new', 'today'])).toEqual(['new', 'today', 'inbox']);
    expect(ids('go')).toEqual(['today', 'inbox']);
    expect(ids('go', ['inbox'])).toEqual(['inbox', 'today']);
  });

  it('ignores spaces, so a run-together or split query finds the same command', () => {
    expect(ids('newevent')).toEqual(['new']);
    expect(ids('new event')).toEqual(['new']);
    expect(ids('gotoinbox')).toEqual(['inbox']);
    expect(ids('goto inb')).toEqual(['inbox']);
  });

  it('ranks title matches over keyword matches, and finds letters in order last', () => {
    const more = [...entries, { id: 'add', title: 'Add Calendar', group: 'File', keywords: 'new list' }];
    expect(filterEntries(more, 'new').map((e) => e.id)).toEqual(['new', 'add']);
    expect(filterEntries(more, 'newlist').map((e) => e.id)).toEqual(['add']);
    expect(ids('nwev')).toEqual(['new']);
    expect(ids('zzz')).toEqual([]);
  });
});

describe('list popups', () => {
  const k = (key: string, shiftKey = false) => ({
    key,
    shiftKey,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  });
  it('Tab and Shift+Tab move the highlight like ↓ and ↑, stopping at the ends', () => {
    expect(listStep(k('Tab'), 0, 3)).toBe(1);
    expect(listStep(k('ArrowDown'), 0, 3)).toBe(1);
    expect(listStep(k('Tab'), 2, 3)).toBe(2);
    expect(listStep(k('Tab', true), 2, 3)).toBe(1);
    expect(listStep(k('ArrowUp'), 2, 3)).toBe(1);
    expect(listStep(k('Tab', true), 0, 3)).toBe(0);
    expect(listStep(k('Tab'), 0, 0)).toBe(0);
    expect(listStep({ ...k('Tab'), ctrlKey: true }, 0, 3)).toBeUndefined();
    expect(listStep(k('Enter'), 0, 3)).toBeUndefined();
  });
});

describe('the shortcut finder', () => {
  it('names every command a key is bound to, whatever has focus or is on', () => {
    const { c, ran } = catalog([
      {
        id: 'off',
        title: 'off',
        description: '',
        group: 'Edit',
        shortcuts: ['mod+k'],
        enabled: () => false,
        run: () => {},
      },
    ]);
    const found = c.lookup(key({ key: 'k', metaKey: true }), null, true);
    expect(found?.kind === 'run' && found.commands.map((x) => x.id)).toEqual(['menu', 'off']);
    expect(c.lookup(key({ key: 'x' }), null, true)).toBeNull();
    // Plain Space is Complete, even though it would type a space in a text field.
    const space = c.lookup(key({ key: ' ' }), null, true);
    expect(space?.kind === 'run' && space.commands[0]?.id).toBe('complete');
    expect(ran).toEqual([]);
  });

  it('waits for the second key of a sequence, and keeps no state of its own', () => {
    const { c } = catalog();
    const g = c.lookup(key({ key: 'g' }), null, true);
    expect(g?.kind).toBe('wait');
    const first = g?.kind === 'wait' ? g.first : null;
    const i = c.lookup(key({ key: 'i' }), first, true);
    expect(i?.kind === 'run' && i.commands.map((x) => x.id)).toEqual(['inbox']);
    expect(c.lookup(key({ key: 'z' }), first, true)).toBeNull();
    // The real key handler has no pending g from the finder.
    expect(c.forEvent(key({ key: 'i' }), 'list', 0, true)).toBeNull();
  });

  it('labels any key press like the shortcut list does', () => {
    expect(eventLabel(key({ key: 'K', metaKey: true, shiftKey: true }), true)).toBe('⇧⌘K');
    expect(eventLabel(key({ key: 'k', ctrlKey: true, shiftKey: true }), false)).toBe('Ctrl+Shift+K');
    expect(eventLabel(key({ key: 'ArrowDown' }), true)).toBe('↓');
    expect(eventLabel(key({ key: ' ' }), false)).toBe('Space');
  });
});

/** A key press that a listener can cancel and stop, like the browser's. */
class FakeKey extends Event {
  readonly key: string;
  readonly code = '';
  readonly metaKey: boolean;
  readonly ctrlKey = false;
  readonly shiftKey = false;
  readonly altKey = false;
  constructor(key: string, metaKey = false) {
    super('keydown', { cancelable: true });
    this.key = key;
    this.metaKey = metaKey;
  }
}

/** A window with no focused element, so keys go to the calendar. */
function fakeWindow() {
  return Object.assign(new EventTarget(), { document: { activeElement: null } }) as unknown as Window;
}

describe('capturing keys for the finder', () => {
  function setup() {
    const target = fakeWindow();
    const { c, ran } = catalog();
    const press = (k: string, meta = false) => {
      const e = new FakeKey(k, meta);
      target.dispatchEvent(e);
      return e;
    };
    return { target, c, ran, press };
  }

  it('takes every key before the app, except Escape, until stopped', () => {
    const { target, c, ran, press } = setup();
    const seen: string[] = [];
    const stop = captureKeys(
      target,
      (e) => void seen.push(e.key),
      () => {},
    );
    listenForKeys(target, c, () => false);
    expect(press('k', true).defaultPrevented).toBe(true);
    expect(press('Escape').defaultPrevented).toBe(false);
    expect(seen).toEqual(['k']);
    expect(ran).toEqual([]);
    stop();
    stop();
    press('k', true);
    expect(seen).toEqual(['k']);
    expect(ran).toEqual(['menu']);
  });

  it('stops by itself when no key is pressed for a while, and each key press restarts the wait', () => {
    vi.useFakeTimers();
    try {
      const { target, c, ran, press } = setup();
      const seen: string[] = [];
      const ended = vi.fn();
      captureKeys(target, (e) => void seen.push(e.key), ended);
      listenForKeys(target, c, () => false);
      vi.advanceTimersByTime(CAPTURE_IDLE_MS - 1);
      press('k', true);
      vi.advanceTimersByTime(CAPTURE_IDLE_MS - 1);
      expect(ended).not.toHaveBeenCalled();
      expect(seen).toEqual(['k']);
      vi.advanceTimersByTime(1);
      expect(ended).toHaveBeenCalledOnce();
      press('k', true);
      expect(seen).toEqual(['k']);
      expect(ran).toEqual(['menu']);
      vi.advanceTimersByTime(CAPTURE_IDLE_MS * 2);
      expect(ended).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stopped by hand, it never ends by itself later', () => {
    vi.useFakeTimers();
    try {
      const { target } = setup();
      const ended = vi.fn();
      const stop = captureKeys(target, () => {}, ended);
      stop();
      vi.advanceTimersByTime(CAPTURE_IDLE_MS * 2);
      expect(ended).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets keys reach the app again after the finder throws', async () => {
    const { target, c, ran, press } = setup();
    const ended = vi.fn();
    captureKeys(
      target,
      () => {
        throw new Error('lookup failed');
      },
      ended,
    );
    listenForKeys(target, c, () => false);
    // Node reports a listener's error as uncaught on the next tick, as a browser reports it to the console.
    const errors: unknown[] = [];
    const onError = (e: unknown) => void errors.push(e);
    process.on('uncaughtException', onError);
    try {
      press('x');
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off('uncaughtException', onError);
    }
    expect(errors).toEqual([new Error('lookup failed')]);
    expect(ended).toHaveBeenCalledOnce();
    press('k', true);
    press('k', true);
    expect(ran).toEqual(['menu', 'menu']);
    expect(ended).toHaveBeenCalledOnce();
  });
});
