import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTextFile, versionOf, writeAtomic } from '../src/index.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'daybird-files-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('atomic files', () => {
  it('writes, reads back and versions the text', async () => {
    const file = path.join(dir, 'sub', 'home.ics');
    await writeAtomic(file, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    const read = await readTextFile(file);
    expect(read.text).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    expect(read.version).toBe(versionOf(read.text!));
    expect(await readdir(path.dirname(file))).toEqual(['home.ics']);
  });

  it('reads a missing file as nulls', async () => {
    expect(await readTextFile(path.join(dir, 'none.ics'))).toEqual({ text: null, version: null });
  });

  it('replaces a symlink target and keeps the link', async () => {
    const real = path.join(dir, 'real.ics');
    const link = path.join(dir, 'link.ics');
    await writeFile(real, 'old');
    await symlink(real, link);
    await writeAtomic(link, 'new');
    expect(await readFile(real, 'utf8')).toBe('new');
    expect((await readTextFile(link)).text).toBe('new');
  });
});
