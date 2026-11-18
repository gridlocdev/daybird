// The desktop app's pure parts, for its tests. Electron starts from main.ts.
export { Channels, type NativeMenuItem } from './bridge.ts';
export { editMenuTemplate, toTemplate, withStandardMenus, type EditMenuParams } from './menu.ts';
export { appFile, dataPaths, isAppUrl, type DataPaths } from './paths.ts';
export {
  loadSavedWindow,
  parseSavedWindow,
  placeWindow,
  saveWindow,
  type SavedWindow,
} from './windowState.ts';
export { Folders, loadFolderChoice, saveFolderChoice, type FolderInfo } from './folders.ts';
export {
  icsArguments,
  isIcsPath,
  OpenedFiles,
  readOpened,
  MAX_OPENED_BYTES,
  type OpenedFile,
} from './openedFiles.ts';
