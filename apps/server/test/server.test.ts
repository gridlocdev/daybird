import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, DEFAULT_PORT, parsePort } from '../src/index.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'daybird-server-'));
const server = createServer({ staticDir: path.join(dir, 'web') });
let base: string;

beforeAll(async () => {
  mkdirSync(path.join(dir, 'web', 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'web', 'index.html'), '<title>Daybird</title>');
  writeFileSync(path.join(dir, 'web', 'assets', 'app-1.js'), 'export {};');
  writeFileSync(path.join(dir, 'secret.txt'), 'no');
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

  it('has no API yet and refuses writes', async () => {
    expect((await get('/api/info')).status).toBe(404);
    expect((await get('/', { method: 'POST' })).status).toBe(405);
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
