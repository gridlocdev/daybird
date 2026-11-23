/**
 * Picking a calendar folder in the browser (PRD §3.7). Chrome and Edge have `showDirectoryPicker`, which gives a
 * folder Daybird can save to; Firefox and Safari have `<input type="file" webkitdirectory>`, which gives a
 * read-only snapshot of its files. The choice is made by what the browser has, never by its name.
 */

/** How this browser can open a folder on the computer, if at all. */
export type FolderPicking = 'handle' | 'files' | 'none';

type DirectoryPicker = (options?: {
  readonly id?: string;
  readonly mode?: 'read' | 'readwrite';
}) => Promise<FileSystemDirectoryHandle>;

const directoryPicker = (win: Window): DirectoryPicker | undefined =>
  (win as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

export function folderPicking(win: Window = window): FolderPicking {
  if (typeof directoryPicker(win) === 'function') return 'handle';
  if (typeof HTMLInputElement !== 'undefined' && 'webkitdirectory' in HTMLInputElement.prototype)
    return 'files';
  return 'none';
}

/** Asks for a folder Daybird can save to; null when the user cancelled. */
export async function pickFolderHandle(win: Window = window): Promise<FileSystemDirectoryHandle | null> {
  const pick = directoryPicker(win);
  if (!pick) return null;
  try {
    return await pick.call(win, { id: 'daybird', mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/**
 * Asks for a folder with the file input: every file under it, or null when the user cancelled. Older browsers
 * fire no `cancel`, so the promise can stay pending; nothing waits on it but the pick itself.
 */
export function pickFolderFiles(doc: Document = document): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.hidden = true;
    const done = (files: File[] | null) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(input.files ? [...input.files] : null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    doc.body.append(input);
    input.click();
  });
}
