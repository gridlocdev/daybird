import { lstat, mkdtemp, readFile, readlink, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderError, FolderStore, folderResult, lockPathOf, versionOf, withLockFile } from '../src/index.ts';

let dir: string;
let store: FolderStore;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'daybird-folder-'));
  store = new FolderStore(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'no error',
    (e: unknown) => (e instanceof FolderError ? e.code : String(e)),
  );

describe('the folder store', () => {
  it('refuses paths that leave the folder', async () => {
    for (const p of ['../x.ics', 'a/../../x.ics', '/etc/passwd', 'a\\..\\x.ics', './x.ics'])
      expect(await code(store.read(p)), p).toBe('outside');
    expect(await code(store.write('../x.ics', bytes('x')))).toBe('outside');
  });

  it('lists neither its temp files nor its lock files', async () => {
    await store.write('Home.ics', bytes('h'));
    await writeFile(path.join(dir, '.Home.ics.0123456789ab.tmp'), 'partial');
    await writeFile(lockPathOf(path.join(dir, 'Home.ics')), '1');
    expect((await store.list('')).map((e) => e.name)).toEqual(['Home.ics']);
  });

  it('saves through a symlink to its target and keeps the link', async () => {
    const real = path.join(dir, 'real.ics');
    await writeFile(real, 'one');
    await symlink(real, path.join(dir, 'Link.ics'));
    const { version } = await store.read('Link.ics');
    await store.write('Link.ics', bytes('two'), { expected: version });
    expect((await lstat(path.join(dir, 'Link.ics'))).isSymbolicLink()).toBe(true);
    expect(await readlink(path.join(dir, 'Link.ics'))).toBe(real);
    expect(await readFile(real, 'utf8')).toBe('two');
  });

  it('lets one of two racing conditional saves through, and the other sees the change', async () => {
    const other = new FolderStore(dir);
    const base = await store.write('a.ics', bytes('base'));
    const results = await Promise.all([
      code(store.write('a.ics', bytes('mine'), { expected: base })),
      code(other.write('a.ics', bytes('theirs'), { expected: base })),
    ]);
    expect(results.sort()).toEqual(['changed', 'no error']);
    const text = await readFile(path.join(dir, 'a.ics'), 'utf8');
    expect(['mine', 'theirs']).toContain(text);
    await expect(lstat(lockPathOf(path.join(dir, 'a.ics')))).rejects.toThrow();
  });

  it('versions files by the SHA-256 of their bytes', async () => {
    const version = await store.write('a.ics', bytes('é'));
    expect(version).toBe(versionOf(bytes('é')));
    expect(version).toBe(versionOf('é'));
  });

  it('answers with plain data that crosses IPC', async () => {
    expect(await folderResult(() => store.read('none.ics'))).toMatchObject({ ok: false, code: 'not-found' });
    expect(await folderResult(() => Promise.reject(new Error('disk full')))).toEqual({
      ok: false,
      code: 'failed',
      message: 'disk full',
    });
  });
});

describe('lock files', () => {
  it('takes over a lock left by a process that died', async () => {
    const file = path.join(dir, 'a.ics');
    const lock = lockPathOf(file);
    await writeFile(lock, '99999');
    const old = new Date(Date.now() - 11_000);
    await utimes(lock, old, old);
    expect(await withLockFile(file, () => Promise.resolve('ran'))).toBe('ran');
    await expect(lstat(lock)).rejects.toThrow();
  });

  it('waits for a lock that another save keeps fresh, then gives up', async () => {
    const file = path.join(dir, 'a.ics');
    const lock = lockPathOf(file);
    await writeFile(lock, '1');
    // Touched a minute ahead, so it never looks left behind while the clock runs on.
    const later = new Date(Date.now() + 60_000);
    await utimes(lock, later, later);
    let clock = Date.now();
    const now = () => (clock += 1000);
    await expect(withLockFile(file, () => Promise.resolve('ran'), now)).rejects.toThrow(
      'is being saved by another program',
    );
  });

  it('lets the next save in when the one holding it finishes, even by failing', async () => {
    const file = path.join(dir, 'a.ics');
    const order: string[] = [];
    let entered!: () => void;
    const holding = new Promise<void>((r) => (entered = r));
    const first = withLockFile(file, async () => {
      order.push('first');
      entered();
      await new Promise((r) => setTimeout(r, 30));
      throw new Error('boom');
    });
    await holding;
    const second = withLockFile(file, () => {
      order.push('second');
      return Promise.resolve();
    });
    await expect(first).rejects.toThrow('boom');
    await second;
    expect(order).toEqual(['first', 'second']);
  });
});
