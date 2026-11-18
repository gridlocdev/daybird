import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { icsArguments, OpenedFiles } from '../src/index.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'daybird-opened-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('opened .ics files', () => {
  it('come from the launch arguments, resolved against its folder', () => {
    expect(
      icsArguments(['--inspect', 'out/main.js', 'Work.ICS', '/a/b.ics', 'notes.txt'], '/home/me'),
    ).toEqual([path.resolve('/home/me/Work.ICS'), path.resolve('/a/b.ics')]);
  });

  it('wait until taken, once each, and say why one could not be read', async () => {
    const file = path.join(dir, 'Invite.ics');
    writeFileSync(file, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    const opened = new OpenedFiles();
    expect(opened.add([file, file, path.join(dir, 'gone.ics'), path.join(dir, 'x.txt')])).toBe(true);
    expect(opened.add([file]), 'already waiting').toBe(false);
    expect(await opened.take()).toEqual([
      { ok: true, name: 'Invite.ics', text: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' },
      { ok: false, name: 'gone.ics', message: 'it’s gone' },
    ]);
    expect(await opened.take()).toEqual([]);
  });
});
