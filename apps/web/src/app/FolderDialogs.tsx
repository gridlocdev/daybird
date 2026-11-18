import { Dialog, type Conflict, type FolderSession, type RecoveryOffer } from '@daybird/ui';
import type { AppController } from './controller.ts';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function list(names: readonly string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;
}

/**
 * A closed window left unsaved changes (PRD §3.6). The user has to choose: nothing in those files is saved
 * until then, so Escape and the backdrop leave the dialog up.
 */
export function RecoveryDialog({
  session,
  offer,
}: {
  readonly session: FolderSession;
  readonly offer: RecoveryOffer;
}) {
  const names = offer.files.map((f) => f.name);
  const when = new Date(offer.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Dialog
      title="Restore unsaved changes?"
      onClose={() => undefined}
      onSubmit={() => session.restoreRecovery()}
      actions={
        <>
          <button type="button" class="db-button" onClick={() => session.discardRecovery()}>
            Discard
          </button>
          <button type="submit" class="db-button db-button-primary" data-autofocus>
            Restore
          </button>
        </>
      }
    >
      <p>
        A Daybird window closed on {when} before it could save changes to {list(names)}. Restore puts those
        changes back, as one step you can undo, and saves them. Discard keeps the calendars as they are on
        disk.
      </p>
    </Dialog>
  );
}

/**
 * A calendar changed or went somewhere else while this window had unsaved changes (PRD §3.5). Nothing merges and
 * nothing is overwritten until the user picks one of the three; Escape leaves the dialog up.
 */
export function ConflictDialog({
  app,
  session,
  conflict,
}: {
  readonly app: AppController;
  readonly session: FolderSession;
  readonly conflict: Conflict;
}) {
  const deleted = conflict.reason === 'deleted';
  const choose = (choice: 'saveCopy' | 'keepMine' | 'useTheirs') => {
    void session.resolve(conflict.path, choice).catch((e: unknown) => {
      app.say(`Couldn’t do that: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
    });
  };
  return (
    <Dialog
      title={`${conflict.name} ${deleted ? 'was deleted' : 'changed'} somewhere else`}
      onClose={() => undefined}
      onSubmit={() => choose('saveCopy')}
      actions={
        <>
          <button type="button" class="db-button" onClick={() => choose('useTheirs')}>
            Use Theirs
          </button>
          <button type="button" class="db-button" onClick={() => choose('keepMine')}>
            Keep Mine
          </button>
          <button type="submit" class="db-button db-button-primary" data-autofocus>
            Save Mine as a Copy
          </button>
        </>
      }
    >
      <p>
        {deleted
          ? `The file for ${conflict.name} was deleted while this window had changes to it that weren’t saved.`
          : `${conflict.name} was changed by another app or window while this window had changes to it that weren’t saved. ${plural(conflict.differs, 'event')} differ.`}
      </p>
      <ul class="db-choices">
        <li>
          <strong>Save Mine as a Copy</strong> keeps this window’s version as a new calendar, “{conflict.name}{' '}
          copy”, and {deleted ? 'removes this one' : 'shows the other version here'}.
        </li>
        <li>
          <strong>Keep Mine</strong>{' '}
          {deleted ? 'writes the file again' : 'writes this window’s version over the other one'}.
        </li>
        <li>
          <strong>Use Theirs</strong> {deleted ? 'removes the calendar' : 'drops this window’s changes'}.
        </li>
      </ul>
    </Dialog>
  );
}
