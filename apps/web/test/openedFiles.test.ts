import { describe, expect, it } from 'vitest';
import type { FolderSession } from '@daybird/ui';
import { importOpenedFiles, type OpenedFile } from '../src/index.ts';
import { makeApp } from './helpers.ts';

const ics = (summary: string) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VEVENT',
    `UID:${summary}@test`,
    'DTSTAMP:20261117T100000Z',
    'DTSTART:20261118T090000Z',
    'DTEND:20261118T100000Z',
    `SUMMARY:${summary}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

/** A main process with files waiting, as the desktop bridge gives them. */
function source(files: OpenedFile[]) {
  let waiting = [...files];
  let opened = () => {};
  return {
    onFilesOpened: (fn: () => void) => (opened = fn),
    takeOpenedFiles: () => {
      const taken = waiting;
      waiting = [];
      return Promise.resolve(taken);
    },
    open(more: OpenedFile[]) {
      waiting.push(...more);
      opened();
    },
  };
}

/** Lets the promises in flight finish. */
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('files opened from the Finder', () => {
  it('wait for an open folder, then offer each for import in turn', async () => {
    const { app } = await makeApp();
    const files = source([
      { ok: true, name: 'a.ics', text: ics('Alpha') },
      { ok: true, name: 'b.ics', text: ics('Beta') },
    ]);
    const offered = () => app.importOffer.peek()?.fileName ?? null;
    const stop = importOpenedFiles(app, files);
    await settle();
    expect(offered(), 'no folder yet').toBeNull();

    app.session.value = {} as FolderSession;
    await settle();
    expect(offered()).toBe('a.ics');
    app.importOffer.value = null;
    expect(offered()).toBe('b.ics');
    app.importOffer.value = null;

    files.open([{ ok: false, name: 'c.ics', message: 'it’s gone' }]);
    await settle();
    expect(offered()).toBeNull();
    expect(app.notice.value?.text).toBe('Couldn’t import c.ics: it’s gone.');
    stop();
  });
});
