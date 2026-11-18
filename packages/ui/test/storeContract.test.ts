// One contract for every CalendarStore: the folder session relies on these answers whatever the folder is
// backed by. The NAS store joins the list when it arrives.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FolderStore, folderResult } from '@daybird/node-files';
import {
  BrowserStore,
  ConflictError,
  MemoryStore,
  NativeStore,
  NotFoundError,
  decodeText,
  encodeText,
  versionOf,
  type CalendarStore,
  type NativeFiles,
} from '../src/index.ts';
import { fakeFolder } from './fakeFileSystem.ts';

const temp = mkdtempSync(path.join(tmpdir(), 'daybird-contract-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let folders = 0;

/** The desktop app's store: the page's NativeStore over the main process's FolderStore, as the bridge joins them. */
function nativeStore(): CalendarStore {
  const disk = new FolderStore(path.join(temp, `folder ${++folders}`));
  const files: NativeFiles = {
    list: (dir) => folderResult(() => disk.list(dir)),
    read: (p) => folderResult(() => disk.read(p)),
    write: (p, bytes, opts) => folderResult(() => disk.write(p, bytes, opts)),
    move: (from, to) => folderResult(() => disk.move(from, to)),
    remove: (p) => folderResult(() => disk.remove(p)),
  };
  return new NativeStore(files, 'Calendars', disk.root);
}

const stores: [string, () => CalendarStore][] = [
  ['NativeStore over FolderStore', nativeStore],
  ['MemoryStore', () => new MemoryStore('Calendars')],
  [
    'BrowserStore',
    () => new BrowserStore(fakeFolder('Calendars').root as unknown as FileSystemDirectoryHandle),
  ],
];

describe.each(stores)('%s keeps the store contract', (_name, make) => {
  let store: CalendarStore;
  beforeEach(() => {
    store = make();
  });

  const text = async (p: string) => decodeText((await store.read(p)).bytes);
  const reason = (p: Promise<unknown>) =>
    p.then(
      () => 'no error',
      (e: unknown) => (e instanceof ConflictError ? e.reason : String(e)),
    );

  it('reads back what it wrote, with the SHA-256 of the bytes as the version', async () => {
    const version = await store.write('Work.ics', encodeText('hello'));
    const read = await store.read('Work.ics');
    expect(decodeText(read.bytes)).toBe('hello');
    expect(read.version).toBe(version);
    expect(version).toBe(await versionOf(encodeText('hello')));
    expect(version).toMatch(/^[0-9a-f]{64}$/);
  });

  it('makes parent folders, and lists files and folders with folder paths', async () => {
    await store.write('.daybird/trash.ics', encodeText('t'));
    await store.write('Home.ics', encodeText('h'));
    const root = (await store.list('')).map((e) => [e.path, e.kind]).sort();
    expect(root).toEqual([
      ['.daybird', 'dir'],
      ['Home.ics', 'file'],
    ]);
    expect((await store.list('.daybird')).map((e) => [e.path, e.name, e.size])).toEqual([
      ['.daybird/trash.ics', 'trash.ics', 1],
    ]);
    expect(await store.list('missing')).toEqual([]);
  });

  it('refuses a save over a version it did not read', async () => {
    const first = await store.write('a.ics', encodeText('one'));
    await store.write('a.ics', encodeText('two, from elsewhere'));
    expect(await reason(store.write('a.ics', encodeText('mine'), { expected: first }))).toBe('changed');
    expect(await text('a.ics')).toBe('two, from elsewhere');
  });

  it('saves over the version it read', async () => {
    const first = await store.write('a.ics', encodeText('one'));
    const second = await store.write('a.ics', encodeText('two'), { expected: first });
    expect(await text('a.ics')).toBe('two');
    expect(second).not.toBe(first);
  });

  it('does not bring back a file deleted since it was read', async () => {
    const version = await store.write('a.ics', encodeText('one'));
    await store.remove('a.ics');
    expect(await reason(store.write('a.ics', encodeText('mine'), { expected: version }))).toBe('deleted');
    await expect(store.read('a.ics')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('does not make the folders of a file deleted since it was read', async () => {
    const version = await store.write('.daybird/trash.ics', encodeText('one'));
    await store.remove('.daybird/trash.ics');
    expect(await reason(store.write('.daybird/trash.ics', encodeText('mine'), { expected: version }))).toBe(
      'deleted',
    );
  });

  it('refuses to create over an existing file, and an unconditional save overwrites', async () => {
    await store.write('a.ics', encodeText('one'));
    expect(await reason(store.write('a.ics', encodeText('new'), { create: true }))).toBe('exists');
    await store.write('a.ics', encodeText('forced'));
    expect(await text('a.ics')).toBe('forced');
  });

  it('throws NotFoundError for a missing file', async () => {
    await expect(store.read('nope.ics')).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.remove('nope.ics')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('moves a file, into a folder too, and refuses a taken name', async () => {
    await store.write('a.ics', encodeText('a'));
    await store.write('b.ics', encodeText('b'));
    await store.move('a.ics', '.daybird/trash/a.ics');
    expect(await text('.daybird/trash/a.ics')).toBe('a');
    await expect(store.read('a.ics')).rejects.toBeInstanceOf(NotFoundError);
    expect(await reason(store.move('b.ics', '.daybird/trash/a.ics'))).toBe('exists');
    expect(await text('b.ics')).toBe('b');
  });
});
