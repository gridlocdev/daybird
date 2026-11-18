/** Files the user picks to import, and files saved to their computer (PRD §11), through the browser's own dialogs. */
import { after } from '@daybird/ui';

/** Asks for one file; null when the user cancels. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

/** Saves `data` as a download named `name`. */
export function saveFile(name: string, data: Uint8Array<ArrayBuffer> | string, type: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // The download has started by the next task; the URL can go.
  after(1_000, () => URL.revokeObjectURL(url));
}
