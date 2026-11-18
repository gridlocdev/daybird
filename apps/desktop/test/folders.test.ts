import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Folders } from '../src/index.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'daybird-folders-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe('the desktop folder', () => {
  it('has none on first start, then remembers the one chosen', async () => {
    const choice = path.join(dir, 'data', 'folder.json');
    const first = new Folders(choice, null);
    await first.start();
    expect(first.current()).toBeNull();
    const opened = await first.open(path.join(dir, 'Documents', 'Daybird'));
    expect(opened).toEqual({ path: path.join(dir, 'Documents', 'Daybird'), name: 'Daybird', missing: false });

    const next = new Folders(choice, null);
    await next.start();
    expect(next.current()).toEqual(opened);
  });

  it('reports a remembered folder that is gone, without making it again', async () => {
    const choice = path.join(dir, 'folder.json');
    const first = new Folders(choice, null);
    await first.start();
    await first.open(path.join(dir, 'Cal'));
    await rm(path.join(dir, 'Cal'), { recursive: true });
    const next = new Folders(choice, null);
    await next.start();
    expect(next.current()).toMatchObject({ name: 'Cal', missing: true });
    expect(await next.call('list', [''])).toMatchObject({ ok: false, code: 'failed' });
  });

  it('uses a folder given for the run without remembering it', async () => {
    const choice = path.join(dir, 'folder.json');
    const folders = new Folders(choice, path.join(dir, 'Fixed'));
    await folders.start();
    expect(folders.current()?.name).toBe('Fixed');
    await folders.open(path.join(dir, 'Other'));
    await expect(readFile(choice, 'utf8')).rejects.toThrow();
  });

  it('runs file calls on the open folder and refuses bad arguments', async () => {
    const folders = new Folders(path.join(dir, 'folder.json'), path.join(dir, 'Cal'));
    await folders.start();
    const written = await folders.call('write', ['Home.ics', bytes('h'), { create: true }]);
    expect(written.ok).toBe(true);
    expect(await folders.call('write', ['Home.ics', bytes('x'), { create: true }])).toMatchObject({
      ok: false,
      code: 'exists',
    });
    expect(await folders.call('read', ['../escape.ics'])).toMatchObject({ ok: false, code: 'outside' });
    expect(await folders.call('write', ['a.ics', 'not bytes'])).toMatchObject({ ok: false, code: 'failed' });
    expect(await folders.call('format', [])).toMatchObject({ ok: false, code: 'failed' });
  });
});
