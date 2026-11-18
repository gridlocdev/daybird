import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { saveChartMermaid, saveStep, type SaveEvent, type SaveState } from '../src/index.ts';
import { RANDOM_TIMEOUT, runRandomOps, type Op } from './support/randomOps.ts';

/** The chart's state, plus a model of the file on disk and the window's changes around it. */
interface World {
  state: SaveState;
  /** Changes the disk doesn't have yet. */
  unsaved: boolean;
  /** Changes made since the write in flight started. */
  editedSinceWrite: boolean;
  /** Writes started and not yet answered. */
  writes: number;
  /** A retry waits. */
  retry: boolean;
  /** The changes are in the recovery snapshot. */
  copy: boolean;
  /** The conflict dialog is up for the file. */
  flagged: boolean;
  /** The user is answering the conflict dialog. */
  choosing: boolean;
}

function fire(w: World, event: SaveEvent): void {
  const { to, effects } = saveStep(w.state, event);
  w.state = to;
  for (const effect of effects) {
    switch (effect) {
      case 'writeFile':
        expect(w.writes, 'never two writes at once').toBe(0);
        expect(w.flagged, 'nothing is written over a conflict until the user chooses').toBe(false);
        w.writes++;
        w.editedSinceWrite = false;
        break;
      case 'overwriteFile':
        expect(w.writes, 'never two writes at once').toBe(0);
        expect(w.choosing, 'only a conflict choice writes over the disk').toBe(true);
        w.writes++;
        w.editedSinceWrite = false;
        break;
      case 'keepCopy':
        w.copy = true;
        break;
      case 'dropCopy':
        expect(w.unsaved, 'the recovery copy goes only when the disk has every change').toBe(false);
        w.copy = false;
        break;
      case 'scheduleRetry':
        expect(w.retry).toBe(false);
        w.retry = true;
        break;
      case 'cancelRetry':
        w.retry = false;
        break;
      case 'takeFile':
        expect(w.unsaved, 'a refresh never replaces unsaved changes').toBe(false);
        expect(w.writes, 'a refresh never takes a read while a write is out').toBe(0);
        break;
      case 'replaceWithFile':
        expect(w.choosing, 'only the user throws changes away').toBe(true);
        w.unsaved = false;
        w.editedSinceWrite = false;
        break;
      case 'flag':
        w.flagged = true;
        break;
      case 'unflag':
        w.flagged = false;
        break;
      case 'report':
      case 'clearReport':
        break;
    }
  }
}

function answer(w: World, event: 'saved' | 'failed' | 'failedFinal' | 'versionChanged'): void {
  w.writes--;
  if (event === 'saved') w.unsaved = w.editedSinceWrite;
  fire(w, event);
}

const choose = (event: SaveEvent): Op<World> => ({
  name: event,
  when: (w) => w.flagged,
  run: (w) => {
    w.choosing = true;
    fire(w, event);
    w.choosing = false;
  },
});

const refreshable = (w: World) =>
  w.writes === 0 && (w.state === 'clean' || w.state === 'retrying' || w.state === 'failed');

const ops: Op<World>[] = [
  {
    name: 'edit',
    weight: 4,
    when: (w) => w.state !== 'removed',
    run: (w) => {
      w.unsaved = true;
      w.editedSinceWrite = true;
      fire(w, 'edit');
    },
  },
  { name: 'saved', weight: 3, when: (w) => w.writes > 0, run: (w) => answer(w, 'saved') },
  { name: 'failed', when: (w) => w.writes > 0, run: (w) => answer(w, 'failed') },
  { name: 'failedFinal', when: (w) => w.writes > 0, run: (w) => answer(w, 'failedFinal') },
  { name: 'versionChanged', when: (w) => w.writes > 0, run: (w) => answer(w, 'versionChanged') },
  {
    name: 'retryTimer',
    weight: 2,
    when: (w) => w.retry,
    run: (w) => {
      w.retry = false;
      fire(w, 'retryTimer');
    },
  },
  { name: 'outsideChange', when: refreshable, run: (w) => fire(w, 'outsideChange') },
  { name: 'outsideDelete', when: refreshable, run: (w) => fire(w, 'outsideDelete') },
  { name: 'tryAgain', when: (w) => w.state === 'failed', run: (w) => fire(w, 'tryAgain') },
  choose('saveCopy'),
  choose('keepMine'),
  choose('useTheirs'),
  choose('gone'),
];

describe('the save chart', () => {
  it(
    'keeps its promises under random events',
    async () => {
      await runRandomOps<World>({
        setup: () => ({
          state: 'clean',
          unsaved: false,
          editedSinceWrite: false,
          writes: 0,
          retry: false,
          copy: false,
          flagged: false,
          choosing: false,
        }),
        ops,
        steps: 200,
        check: (w) => {
          expect(w.writes <= 1).toBe(true);
          expect(w.writes === 1, 'a write is out exactly while saving').toBe(
            w.state === 'saving' || w.state === 'savingDirty',
          );
          expect(w.retry, 'a retry waits exactly while retrying').toBe(w.state === 'retrying');
          expect(w.flagged, 'the dialog is up exactly in a conflict').toBe(w.state === 'conflict');
          if (w.state === 'clean' || w.state === 'removed') expect(w.unsaved).toBe(false);
          if (w.unsaved) expect(w.copy, 'unsaved changes are in the snapshot').toBe(true);
        },
      });
    },
    RANDOM_TIMEOUT,
  );

  it('is drawn in docs/architecture.md', () => {
    const doc = readFileSync(new URL('../../../docs/architecture.md', import.meta.url), 'utf8');
    expect(doc, 'paste saveChartMermaid() into the Saving section').toContain(saveChartMermaid());
  });
});
