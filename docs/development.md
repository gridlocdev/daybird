# Development

Daybird is a TypeScript pnpm workspace. One Preact build runs in the browser, in the NAS server's client and inside the Electron app; the CLI uses the same engine. [Architecture](architecture.md) explains the layout, and the [product requirements](plans/prd.md) say exactly how everything behaves.

## Getting set up

You need Node 22.18 or later, pnpm (through corepack) and [just](https://github.com/casey/just). Run `just` on its own to list every recipe.

```bash
just setup   # corepack enable, then pnpm install
```

### Running it

| Recipe | What it runs |
| --- | --- |
| `just run-web` | The web client on http://localhost:5173 with hot reload, plus the NAS server on :8796 |
| `just run-server` | The NAS server only, on http://localhost:8796, restarting when its source changes |
| `just preview-web` | The built web client served by the NAS server, as it runs on a NAS |
| `just run-desktop` | The desktop app in dev mode (builds the web client first) |
| `just run-desktop-headless` | The desktop app with no window or Dock icon, on `./.headless-data`, with DevTools on port 9335 (for automated checks) |
| `just cli <args>` | The `daybird` CLI from source, for example `just cli --version` |

To try the desktop app on throwaway data, set `DAYBIRD_USER_DATA` to another folder:

```bash
DAYBIRD_USER_DATA=/tmp/daybird-try just run-desktop
```

## Checking your work

```bash
just check        # everything CI runs: format, lint, typecheck, tests, build
just test         # the tests once (pass a file or -t "name" to narrow them)
just test-watch   # the tests in watch mode
just lint         # ESLint
just typecheck    # tsc -b
just fmt          # format every file with Prettier
just fmt-check    # check formatting without changing anything
just check-arch   # the architecture rules only
just fuzz         # the random-operation tests on 500 seeds (FUZZ_SEED=<n> replays one)
just e2e          # browser scenarios in headless Chromium (pass a file or -g "name")
just e2e-update   # accept new screenshots, after looking at the diff in .e2e-results
just e2e-desktop  # the built desktop app starts headless on a throwaway folder
just soak         # the random tests long, on new seeds from the clock
just drive aria   # a quick headless look: cmd:"Month" key:KeyT shot:after aria
```

Tests live in each package's `test/` folder and run in Node with Vitest. `apps/web/test/controls.test.ts` fails when [Controls](controls.md) and the command catalog disagree, so update that page with any shortcut you add or change.

Browser scenarios live in `e2e/`, one `test.describe` per `##` heading of [Features](features.md); `test/features.test.ts` fails when a feature has no scenarios. They run against the built client and the NAS server on a copy of `e2e/fixtures/basic`, with the page clock fixed at 17 November 2026, 14:00 UTC, in the UTC time zone and the en-US locale. `random-ui.spec.ts` runs a few seeds of random commands, typing and keys; a failure prints `FUZZ_SEED=<n> just e2e -g random` to replay it. Screenshots are compared on macOS only.

Check UI changes without a visible window: `just drive`, the scenarios, or the desktop app started with `just run-desktop-headless`. Never point a check at your real calendars: use `DAYBIRD_USER_DATA` for the desktop app.

## The spec

[docs/plans/prd.md](plans/prd.md) is the spec, in numbered sections. Code cites it (`// PRD §6.2`). When you change a behaviour, change its section in the same commit. If a behaviour isn't in the PRD, decide it and write it down there first. [The 1.0 plan](plans/1-daybird-1.0.md) lists the slices that build 1.0.

## Adding a command

Every action is a command in `apps/web/src/app/commands.ts`: an id, a title, a one-sentence description, a group, its shortcuts and what it runs. From that one entry it appears in the command menu, the menu bar and the Keyboard Shortcuts window. Don't wire a key or a menu item anywhere else. Then add the shortcut to [Controls](controls.md).

## The NAS server

`apps/server` is a `node:http` server with no framework: `daybird-server --dir <folder> [--port <n>] [--host <address>] [--no-auth]`, or `node apps/server/src/main.ts` with the same options. It serves the built web client and, with `--dir`, the file API in `src/fileApi.ts` over that folder. Each option has an environment variable: `DAYBIRD_DIR`, `DAYBIRD_PORT` (default 8796), `DAYBIRD_HOST` (default `127.0.0.1`) and `DAYBIRD_NO_AUTH=1`; `DAYBIRD_HOSTS` lists the names it is reached by and `DAYBIRD_STATIC` points at the built client. On any address but this machine it starts only with `DAYBIRD_NO_AUTH=1`, since it has no accounts: put a reverse proxy with a login in front.

The Docker image builds the client and runs the server on `/data`: `just build-docker`, then `just run-docker` to try it on `./.nas-data`. Copy `compose.example.yaml` to `compose.yaml` on the NAS and set the volume to the calendar folder.

## The CLI

`apps/cli` is the `daybird` command line: `list`, `add`, `edit`, `delete`, `calendars`, `import` and `export` on a calendar folder (`--dir`, else `DAYBIRD_DIR`, else the folder the desktop app opened last). `daybird --help` lists them and `daybird <command> --help` shows each one's options. Run it from source with `just cli <args>`, or link `apps/cli/bin/daybird.mjs` onto your `PATH`. `src/folder.ts` reads the folder and saves only the files a command changed, against the versions it read; on a conflict it runs the command again on a fresh read, once, and then exits with 2. `--json` prints JSON for scripts and agents, and `apps/cli/skill/SKILL.md` teaches an agent to use it.

## Building and packaging the desktop app

```bash
just build                # the web client and the desktop main process
just build-desktop        # the desktop app only, into apps/desktop/out
just package-desktop      # a .dmg and .zip (macOS), AppImage (Linux) or installer (Windows)
just package-desktop-dir  # an unpacked app only, faster for local testing
just install-desktop      # macOS: package and install into /Applications (offers to quit and reopen a running copy)
```

The app icon's source is `assets/icon.svg`. `just icons` renders it into `apps/desktop/build` (`icon.icns`, `icon.ico` and `icon.png`) with Inkscape and macOS's `iconutil`; commit the files it writes, so packaging needs neither.

## Releasing

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which packages the desktop app for macOS, Windows and Linux and publishes them on a GitHub release.

1. Set the same version in every `package.json` under `apps/` and `packages/`.
2. Add a `## X.Y.Z` section to `CHANGELOG.md`. It becomes the release notes.
3. Run `just check`, commit ("Version X.Y.Z"), then tag and push the tag.

`.github/workflows/check.yml` runs `pnpm check` for every pull request.

## Cleaning up

```bash
just clean        # remove build output
just clean-all    # also remove every node_modules (run just setup after)
```
