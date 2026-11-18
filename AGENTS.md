# Daybird — agent guide

Daybird is a calendar app that keeps each calendar in a plain `.ics` file in a folder the user chooses. One UI runs in the browser, in the NAS server's client and in the Electron app; a CLI works on the same files with the same engine. The spec is [docs/plans/prd.md](docs/plans/prd.md), the code layout is [docs/architecture.md](docs/architecture.md), and the commands are in [docs/development.md](docs/development.md).

## Gates

- `just check` (= `pnpm check`) must pass before you commit: Prettier check, ESLint, `tsc -b`, Vitest (including the architecture rules in `test/architecture.test.ts`), and the build.
- When you change behaviour, add or update a test in the package's `test/` folder, and update the PRD section the code cites (`PRD §n`).
- Every bug fix keeps its reproduction: a unit test, a pinned random-operation seed, or a scenario in `e2e/` for what only shows in the running app. A UI change runs `just e2e`.
- When the owner corrects something, turn the correction into a rule in `test/architecture.test.ts` or a test, not a comment or a line here.
- Never add to `test/architecture-baseline.json`. Fix the violation; lower or delete its entry when you do. A comment is never permission: a deliberate exception (`ignoreError(promise, 'why')`, an `eslint-disable`, a `@ts-expect-error`) goes in `test/architecture-exceptions.json` only after the owner agrees.
- Look at the running app with `just drive` (steps such as `cmd:"Month" key:KeyT shot:after aria`), on fixture data. Features are named as in [docs/features.md](docs/features.md); keep it and the scenarios in step.
- Reports on UI changes include the screenshots that show the change, and what wasn't checked.
- Check UI changes headlessly (a browser driven in the background, or the desktop app with `DAYBIRD_HEADLESS=1`). Never open a visible window to check your work. Scenarios use the fixtures in `e2e/fixtures/` only, never real data.

## Layout

| Path | What it is |
| --- | --- |
| `packages/core` | The pure engine: dates and time zones, the iCalendar format, recurrence, views, edits and undo. No DOM or Node (ESLint enforces it). |
| `packages/ui` | Preact and signals: components, the command catalog, dialogs, ⌘K, and the store adapters. |
| `apps/web` | The app shell, the list of commands and the Vite entry point. One static build serves the browser, the NAS server and the desktop app. |
| `apps/server` | The NAS server (`node:http`): serves the client and `/api` over one calendar folder (`--dir`). No framework. |
| `apps/desktop` | The Electron shell: main process, sandboxed preload bridge, native menu. |
| `apps/cli` | The `daybird` CLI, run from source: list, add, edit, delete, calendars, import, export. It depends on `packages/core` and `packages/node-files` only. `skill/SKILL.md` teaches an agent to use it. |

## Golden rules

1. **The engine stays pure.** It has no UI, DOM or Node APIs, and runs the same in a browser, a worker or Node tests.
2. **The files are the source of truth.** No database. A save writes exactly what the user has.
3. **One command catalog.** The command menu, shortcuts, context menus, the Electron menu bar, the Keyboard Shortcuts window and `docs/controls.md` all read it. Don't wire a key or a menu item past it.
4. **The UI reaches files only through the store interface.** It never knows whether data is in memory, in the browser, on the NAS or on disk.
5. **Never lose data.** Saves are atomic everywhere. A conflict is shown and the user chooses; nothing merges or overwrites silently. Deleting goes to the trash.
6. **Security.** The Electron renderer is sandboxed with context isolation; its only native access is the `daybirdNative` bridge, and only to files the user granted. The server confines every path to its root, symlinks included, and checks `Host` against localhost, IP addresses and `DAYBIRD_HOSTS`.
7. **Dependencies.** The runtime dependencies are Preact and `@preact/signals`. Don't add a package without the owner's approval. Pin versions exactly.
8. **Nothing left to interpretation.** If a behaviour isn't in the PRD, stop and ask, then record the answer in the PRD.

## TypeScript conventions

- Strict mode with `noUncheckedIndexedAccess` and `erasableSyntaxOnly`: no enums, parameter properties or namespaces. Use union types and `const` objects.
- Relative imports end in `.ts`. Use `import type` for types only.
- Each package's `src/index.ts` names its exports one by one. Other packages import only through `@daybird/<package>`; the architecture test rejects deep imports.

## Git workflow

- Keep commits small and coherent. Write the message as a plain sentence about the user-visible effect.
- Commit only when `just check` is green and no questions are outstanding.
