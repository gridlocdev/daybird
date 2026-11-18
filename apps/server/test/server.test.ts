import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FolderStore } from '@daybird/node-files';
import {
  bindProblem,
  createServer,
  DEFAULT_PORT,
  hostAllowed,
  parseHosts,
  parsePort,
  servedPath,
} from '../src/index.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'daybird-server-'));
const server = createServer({
  staticDir: path.join(dir, 'web'),
  folder: new FolderStore(path.join(dir, 'calendars')),
  allowedHosts: ['nas.lan'],
});
let base: string;

beforeAll(async () => {
  mkdirSync(path.join(dir, 'web', 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'web', 'index.html'), '<title>Daybird</title>');
  writeFileSync(path.join(dir, 'web', 'assets', 'app-1.js'), 'export {};');
  writeFileSync(path.join(dir, 'secret.txt'), 'no');
  mkdirSync(path.join(dir, 'calendars', 'Photos'), { recursive: true });
  writeFileSync(path.join(dir, 'calendars', 'Work.ics'), 'BEGIN:VCALENDAR');
  writeFileSync(path.join(dir, 'calendars', 'notes.txt'), 'private');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

function get(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${url}`, { ...init, signal: AbortSignal.timeout(5000) });
}

describe('the static server', () => {
  it('serves the web client, with the shell for unknown routes', async () => {
    const page = await get('/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(await page.text()).toContain('Daybird');
    expect(await (await get('/week/2026-11-17')).text()).toContain('Daybird');
  });

  it('marks hashed bundles immutable', async () => {
    const js = await get('/assets/app-1.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
  });

  it('never serves a file outside the client', async () => {
    const res = await get('/..%2Fsecret.txt');
    expect(res.status).toBe(403);
  });

  it('says it has no folder when started without one', async () => {
    const bare = createServer({ staticDir: null, folder: null });
    await new Promise<void>((resolve) => bare.listen(0, '127.0.0.1', resolve));
    const port = (bare.address() as AddressInfo).port;
    const info = await fetch(`http://127.0.0.1:${port}/api/info`).then((r) => r.json());
    const list = await fetch(`http://127.0.0.1:${port}/api/list?path=`);
    await new Promise((resolve) => bare.close(resolve));
    expect(info).toEqual({ app: 'Daybird', name: null });
    expect(list.status).toBe(404);
  });

  it('refuses writes', async () => {
    expect((await get('/', { method: 'POST' })).status).toBe(405);
  });
});

const ours = { 'X-Daybird-Request': '1' };

describe('the file API', () => {
  it('names the folder', async () => {
    expect(await (await get('/api/info')).json()).toEqual({ app: 'Daybird', name: 'calendars' });
  });

  it('lists and serves calendars and Daybird’s own folder only', async () => {
    const list = (await (await get('/api/list?path=')).json()) as { path: string }[];
    expect(list.map((e) => e.path)).toEqual(['Work.ics']);
    expect(await (await get('/api/list?path=Photos')).json()).toEqual([]);
    const file = await get('/api/file?path=Work.ics');
    expect(file.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    const refused = await get('/api/file?path=notes.txt');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'outside' });
    expect((await get('/api/file?path=..%2Fsecret.txt')).status).toBe(403);
  });

  it('answers a stale save with 412 and the conflict', async () => {
    const res = await get('/api/file?path=Work.ics', {
      method: 'PUT',
      headers: { ...ours, 'If-Match': '"0000"' },
      body: 'mine',
    });
    expect(res.status).toBe(412);
    expect(await res.json()).toMatchObject({ code: 'changed' });
  });

  it('changes nothing for a request without its header, as a form on another site would send', async () => {
    const res = await get('/api/file?path=Work.ics', { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect((await get('/api/file?path=Work.ics')).status).toBe(200);
  });

  it('answers only its own host names, and IP addresses', async () => {
    expect(hostAllowed('127.0.0.1:8796', [])).toBe(true);
    expect(hostAllowed('[::1]:8796', [])).toBe(true);
    expect(hostAllowed('localhost', [])).toBe(true);
    expect(hostAllowed('NAS.lan:443', parseHosts(' nas.lan , x.y'))).toBe(true);
    expect(hostAllowed('evil.example', ['nas.lan'])).toBe(false);
    expect(hostAllowed(undefined, [])).toBe(false);
  });

  it('serves top-level calendars and the .daybird folder', () => {
    expect(['', '.daybird', '.daybird/trash.ics', 'Work.ics', 'Home Stuff.ICS'].every(servedPath)).toBe(true);
    expect(['notes.txt', 'Photos/a.ics', '.Work.ics.lock', '../Work.ics'].some(servedPath)).toBe(false);
  });
});

describe('bindProblem', () => {
  it('refuses an address other machines reach unless a proxy with a login is promised', () => {
    expect(bindProblem('127.0.0.1', false)).toBeNull();
    expect(bindProblem('localhost', false)).toBeNull();
    expect(bindProblem('0.0.0.0', false)).toContain('DAYBIRD_NO_AUTH');
    expect(bindProblem('0.0.0.0', true)).toBeNull();
  });
});

describe('parsePort', () => {
  it('reads a port and falls back to the default', () => {
    expect(parsePort('8800')).toBe(8800);
    expect(parsePort(undefined)).toBe(DEFAULT_PORT);
    expect(parsePort('')).toBe(DEFAULT_PORT);
    expect(parsePort('http')).toBe(DEFAULT_PORT);
    expect(parsePort('70000')).toBe(DEFAULT_PORT);
  });
});
