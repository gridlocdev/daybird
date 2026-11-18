/**
 * `.ics` files opened from the Finder, the Explorer or the command line in the desktop app (PRD §14): once a calendar
 * folder is open, each one gets the Import dialog in turn, asking which calendar takes its events (§11).
 */
import { effect } from '@preact/signals';
import type { AppController } from './controller.ts';
import { offerImport } from './importExport.ts';
import type { OpenedFile } from './native.ts';

export interface OpenedFileSource {
  /** Called when files are waiting. */
  onFilesOpened(fn: () => void): void;
  takeOpenedFiles(): Promise<readonly OpenedFile[]>;
}

/** Offers each opened file for import, one dialog at a time. Returns a function that stops listening. */
export function importOpenedFiles(app: AppController, source: OpenedFileSource): () => void {
  const waiting: OpenedFile[] = [];
  const next = () => {
    while (app.importOffer.peek() === null) {
      const f = waiting.shift();
      if (!f) return;
      if (f.ok) offerImport(app, f.name, f.text);
      else app.say(`Couldn’t import ${f.name}: ${f.message}.`, { tone: 'error' });
    }
  };
  const take = async () => {
    // Without an open folder there's nowhere to import to: the files wait in the main process.
    if (!app.session.peek()) return;
    try {
      waiting.push(...(await source.takeOpenedFiles()));
    } catch (e) {
      app.say(`Couldn’t open the file: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
    }
    next();
  };
  source.onFilesOpened(() => void take());
  const stopSession = effect(() => {
    if (app.session.value) void take();
  });
  // The dialog closed (imported or cancelled): the next file's turn.
  const stopDialog = effect(() => {
    if (app.importOffer.value === null) next();
  });
  return () => {
    stopSession();
    stopDialog();
  };
}
