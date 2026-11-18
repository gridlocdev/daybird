import { memorySettings, type Settings } from '@daybird/ui';
import { AppController, buildCommands, type ControllerOptions } from '../src/index.ts';

/** 2026-11-17 10:00 UTC, a Tuesday. */
export const NOW = Date.UTC(2026, 10, 17, 10, 0);

/** A controller and catalog on in-memory settings and a fixed clock. */
export async function makeApp(
  settings: Partial<Settings> = {},
  now: () => number = () => NOW,
  options: Partial<ControllerOptions> = {},
) {
  const storage = memorySettings(settings);
  const app = new AppController({
    settings: storage,
    version: '0.0.0-test',
    now,
    locale: 'en-US',
    ...options,
  });
  const catalog = buildCommands(app);
  return Promise.resolve({ app, catalog, storage });
}

/** The desktop app's folder chooser, doing nothing: for the commands only the desktop app has. */
export const noFolders = { choose: () => Promise.resolve(), useDefault: () => Promise.resolve() };
