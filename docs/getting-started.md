# Getting started

You can run Daybird as a desktop app on Linux, macOS or Windows, from source in a browser, on a NAS with Docker, or as the `daybird` command line. They all work on the same folder of `.ics` files.

## What you need

- For the desktop app: Linux on x86-64, macOS 12 or later (Apple silicon or Intel), or Windows 10 or later on x86-64.
- For running from source, the NAS server or the command line: Node 22.18 or later, pnpm (through `corepack enable`) and [just](https://github.com/casey/just).

## Download

Get the file for your system from the [latest release](../../releases/latest):

- **Linux:** the `.AppImage`. Make it executable and run it: `chmod +x Daybird-*.AppImage && ./Daybird-*.AppImage`. To import an `.ics` file, pass it as an argument: `./Daybird-*.AppImage invite.ics`.
- **macOS:** the `.dmg`. Drag Daybird to Applications. The build isn't signed by Apple, so the first time macOS won't open it: choose **Open Anyway** in System Settings → Privacy & Security.
- **Windows:** the `.exe` installer.

## First run

Daybird asks where to keep your calendars. **Use Documents/Daybird** makes `~/Documents/Daybird` with a first calendar in it; you can also pick any folder, such as one synced with another machine. **Open Calendar Folder…** (**Ctrl+O**, **⌘O**) switches folders later.

Press **Ctrl+/** (**⌘/**) to see every shortcut, or **Ctrl+K** (**⌘K**) to find a command by name. [Working from the keyboard](guides/working-from-the-keyboard.md) walks through a day's use.

Daybird keeps its own settings (the window's place, the folder it opened) in `~/.config/Daybird` on Linux, `~/Library/Application Support/Daybird` on macOS and `%APPDATA%\Daybird` on Windows. Your calendars stay in the folder you chose.

## Run it from source

```bash
just setup     # enable corepack and install the dependencies
just run-web   # the app on http://localhost:5173, with the NAS server on :8796
```

`just run-desktop` runs the desktop app from source instead. In the browser, calendars are kept in the browser itself, and the status bar says so. **Open Calendar Folder…** (⌘O) opens a folder from your computer instead: Chrome and Edge save to it, and Firefox and Safari open it read-only.

## Run it on a NAS (Docker)

The server serves the app and one calendar folder to every browser that opens it. In a checkout of this repository on the NAS, copy `compose.example.yaml` to `compose.yaml`, set the volume to your calendar folder, and start it:

```bash
docker compose up -d   # builds the image and serves it on port 8796
```

The server has no accounts: anyone who can reach it can read and change the calendars. Put it behind a reverse proxy that asks for a login. Without Docker, run `daybird-server --dir <folder>` from a checkout.

## The command line

`daybird` lists, adds, changes and deletes events, lists the calendars, and imports and exports `.ics` files. Without `--dir` it works on the folder the desktop app opened last.

```bash
ln -s "$PWD/apps/cli/bin/daybird.mjs" ~/.local/bin/daybird   # from a checkout, after just setup
daybird list --from 2026-11-16 --to 2026-11-22
daybird add "Dentist" --start 2026-11-20T15:30 --duration 45m
```

`daybird --help` lists every command, and `--json` prints JSON for scripts. A Daybird window that's open picks up what the command changes.
