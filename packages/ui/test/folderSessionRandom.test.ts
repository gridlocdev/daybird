// Random edits, undo, outside changes, failing writes, refreshes and conflict choices against one folder. At the
// end, with the disk working again and every conflict answered Keep Mine, the disk holds exactly what the window
// shows: nothing the window kept was lost, and nothing it saved was left unsaved.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkInvariants, createEvent, writeCalendar } from '@daybird/core';
import {
  FolderSession,
  MemoryStore,
  TRASH_PATH,
  memorySnapshots,
  type ConflictChoice,
} from '../src/index.ts';
import { RANDOM_TIMEOUT, runRandomOps, type Op } from './support/randomOps.ts';

interface World {
  store: MemoryStore;
  session: FolderSession;
  outside: number;
}

const ics = (name: string, events = '') =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//Example//EN\r\nX-WR-CALNAME:${name}\r\n${events}END:VCALENDAR\r\n`;

const vevent = (uid: string, title: string) =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261101T000000Z\r\nDTSTART:20261120T100000\r\nDTEND:20261120T110000\r\nSUMMARY:${title}\r\nEND:VEVENT\r\n`;

const FILES = ['Home.ics', 'Work.ics', 'Trips.ics'];

/** A file as written, without PRODID: a file Daybird never had to write keeps the other app's. */
const withoutProdId = (text: string | null) => text?.replace(/^PRODID:.*\r\n/m, '') ?? null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
  vi.useRealTimers();
});

const ops: Op<World>[] = [
  {
    name: 'add an event',
    weight: 4,
    run: async (w, r) => {
      const calendars = w.session.workspace.peek().calendars.filter((c) => !c.readOnly);
      if (!calendars.length) return 'no calendar';
      const id = r.pick(calendars).id;
      const ws = createEvent(w.session.workspace.peek(), w.session.editContext(), id, {
        title: r.text(8),
        start: { kind: 'date-time', dateTime: '2026-11-21T09:00:00', utc: false, tzid: null },
        end: { kind: 'date-time', dateTime: '2026-11-21T10:00:00', utc: false, tzid: null },
      }).workspace;
      w.session.commit('Add', ws);
      return id;
    },
  },
  { name: 'undo', weight: 2, run: (w) => void w.session.undo() },
  { name: 'redo', run: (w) => void w.session.redo() },
  {
    name: 'change a file elsewhere',
    weight: 2,
    run: (w, r) => {
      const path = r.pick(FILES);
      const before = w.store.text(path);
      const events = (before ?? '').match(/BEGIN:VEVENT[\s\S]*?END:VEVENT\r\n/g)?.join('') ?? '';
      w.store.touch(
        path,
        ics(path.slice(0, -4), events + vevent(`o-${++w.outside}`, `Outside ${w.outside}`)),
      );
      return path;
    },
  },
  {
    name: 'delete a file elsewhere',
    weight: 0.3,
    run: (w, r) => {
      const path = r.pick(FILES);
      w.store.touch(path, null);
      return path;
    },
  },
  {
    name: 'break or mend a file’s writes',
    run: (w, r) => {
      const path = r.pick([...FILES, TRASH_PATH]);
      if (w.store.failWrites.has(path)) w.store.failWrites.delete(path);
      else w.store.failWrites.add(path);
      return path;
    },
  },
  { name: 'refresh', weight: 2, run: (w) => w.session.refresh() },
  {
    name: 'answer a conflict',
    when: (w) => w.session.conflicts.peek().length > 0,
    run: (w, r) => {
      const c = w.session.conflicts.peek()[0]!;
      const choice = r.pick<ConflictChoice>(['saveCopy', 'keepMine', 'useTheirs']);
      return w.session.resolve(c.path, choice).then(() => `${c.path} ${choice}`);
    },
  },
  {
    name: 'try again',
    run: (w) => {
      for (const [path, state] of w.session.states.peek()) if (state === 'failed') w.session.tryAgain(path);
    },
  },
  {
    name: 'time passes',
    weight: 2,
    run: async (w, r) => {
      await vi.advanceTimersByTimeAsync(r.pick([0, 50, 400, 1000]));
    },
  },
];

async function settle(w: World): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await vi.advanceTimersByTimeAsync(1000);
    for (const c of w.session.conflicts.peek()) await w.session.resolve(c.path, 'keepMine');
    for (const [path, state] of w.session.states.peek()) if (state === 'failed') w.session.tryAgain(path);
    const busy = [...w.session.states.peek().values()].some((s) => s !== 'clean' && s !== 'removed');
    if (!busy && !w.session.conflicts.peek().length) return;
  }
  throw new Error(`the session never settled: ${JSON.stringify([...w.session.states.peek()])}`);
}

it(
  'saves exactly what the window shows, whatever happens around it',
  async () => {
    await runRandomOps<World>({
      setup: async () => {
        const store = new MemoryStore('Calendars', {
          'Home.ics': ics('Home', vevent('h1', 'Lunch')),
          'Work.ics': ics('Work'),
        });
        let n = 0;
        const session = await FolderSession.open({
          store,
          snapshots: memorySnapshots('w1'),
          say: () => undefined,
          appVersion: '1.0.0',
          now: () => Date.UTC(2026, 10, 17, 12),
          makeUid: () => `u-${++n}`,
          displayZone: 'UTC',
        });
        return { store, session, outside: 0 };
      },
      ops,
      steps: 60,
      check: (w) => {
        expect(checkInvariants(w.session.workspace.peek(), 'UTC')).toEqual([]);
      },
      finish: async (w) => {
        w.store.failWrites.clear();
        await settle(w);
        await w.session.refresh();
        await settle(w);
        const ws = w.session.workspace.peek();
        for (const c of ws.calendars) {
          if (c.readOnly) continue;
          expect(withoutProdId(w.store.text(c.id)), `${c.id} on disk`).toBe(
            withoutProdId(writeCalendar(c.document)),
          );
        }
        const onDisk = w.store.paths().filter((p) => p.endsWith('.ics') && !p.startsWith('.'));
        expect(onDisk.sort()).toEqual(ws.calendars.map((c) => c.id).sort());
      },
      teardown: (w) => w.session.close(),
    });
  },
  RANDOM_TIMEOUT,
);
