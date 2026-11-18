import { memorySettings, type Settings } from '@daybird/ui';
import { AppController, buildCommands } from '../src/index.ts';

/** 2026-11-17 10:00 UTC, a Tuesday. */
export const NOW = Date.UTC(2026, 10, 17, 10, 0);

/** A controller and catalog on in-memory settings and a fixed clock. */
export async function makeApp(settings: Partial<Settings> = {}, now: () => number = () => NOW) {
  const storage = memorySettings(settings);
  const app = new AppController({ settings: storage, version: '0.0.0-test', now, locale: 'en-US' });
  const catalog = buildCommands(app);
  return Promise.resolve({ app, catalog, storage });
}
