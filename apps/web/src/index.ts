// What the web app's tests reach. The page itself starts from main.tsx.
export {
  AppController,
  NOTICE_ACTION_MS,
  NOTICE_MS,
  type ControllerOptions,
  type DialogKind,
  type FolderChooser,
  type FolderPrompt,
  type Notice,
} from './app/controller.ts';
export { buildCommands } from './app/commands.ts';
export { menuSender, nativeMenu } from './app/nativeMenu.ts';
export {
  findKey,
  shortcutGroups,
  type FoundKey,
  type ShortcutGroup,
  type ShortcutLine,
} from './app/shortcuts.ts';
export { importOpenedFiles, type OpenedFileSource } from './app/openedFiles.ts';
export type { OpenedFile } from './app/native.ts';
