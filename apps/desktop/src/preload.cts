// Sandboxed preload: CommonJS, and it may only require('electron'), so the channel names from
// bridge.ts are repeated here. Keep them in step. It exposes exactly one object, `daybirdNative`.
import type { NativeMenuItem } from './bridge.ts';

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
const version = arg('daybird-version');
const chrome = arg('daybird-chrome') === 'unified' ? 'unified' : 'native';

contextBridge.exposeInMainWorld('daybirdNative', {
  version,
  chrome,
  setMenu: (items: readonly NativeMenuItem[]) => ipcRenderer.send('daybird:set-menu', items),
  onCommand: (fn: (id: string) => void) => ipcRenderer.on('daybird:command', (_e, id: string) => fn(id)),
  onCloseRequested: (fn: () => void) => ipcRenderer.on('daybird:close-requested', () => fn()),
  closeReady: () => ipcRenderer.send('daybird:close-ready'),
  files: {
    list: (dir: string) => ipcRenderer.invoke('daybird:file', 'list', [dir]),
    read: (path: string) => ipcRenderer.invoke('daybird:file', 'read', [path]),
    write: (path: string, bytes: Uint8Array, opts: unknown) =>
      ipcRenderer.invoke('daybird:file', 'write', [path, bytes, opts]),
    move: (from: string, to: string) => ipcRenderer.invoke('daybird:file', 'move', [from, to]),
    remove: (path: string) => ipcRenderer.invoke('daybird:file', 'remove', [path]),
  },
  folder: {
    current: () => ipcRenderer.invoke('daybird:folder-current'),
    choose: () => ipcRenderer.invoke('daybird:folder-choose'),
    useDefault: () => ipcRenderer.invoke('daybird:folder-use-default'),
  },
  onFullScreen: (fn: (full: boolean) => void) =>
    ipcRenderer.on('daybird:full-screen', (_e, full: boolean) => fn(full)),
});
