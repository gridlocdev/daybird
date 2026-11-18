import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appFile, dataPaths, isAppUrl } from '../src/index.ts';

describe('dataPaths', () => {
  it('moves the app files only when a check asks', () => {
    expect(dataPaths({})).toEqual({ userData: null, documents: null, folder: null });
    expect(
      dataPaths({ DAYBIRD_USER_DATA: '/tmp/check', DAYBIRD_DOCUMENTS: '/tmp/docs', DAYBIRD_FOLDER: 'cal' }),
    ).toEqual({
      userData: path.resolve('/tmp/check'),
      documents: path.resolve('/tmp/docs'),
      folder: path.resolve('cal'),
    });
  });
});

describe('app:// files', () => {
  const root = path.resolve('/app/web');

  it('serves only inside the web build', () => {
    expect(appFile(root, '/')).toBe(path.join(root, 'index.html'));
    expect(appFile(root, '/assets/index.js')).toBe(path.join(root, 'assets/index.js'));
    expect(appFile(root, '/../main.js')).toBeNull();
    expect(appFile(root, '/%2e%2e/main.js')).toBeNull();
    expect(appFile(root, '/%E0%A4%A')).toBeNull();
  });

  it('trusts only our own page', () => {
    expect(isAppUrl('app://daybird/index.html')).toBe(true);
    expect(isAppUrl('app://daybird.evil/index.html')).toBe(false);
    expect(isAppUrl('https://example.com/')).toBe(false);
    expect(isAppUrl(undefined)).toBe(false);
  });
});
