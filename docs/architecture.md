# Architecture

Daybird is one TypeScript code base with three hosts and a CLI. The browser, the NAS server's client and the Electron app run the same UI; only where the calendar files come from differs.

```
     ┌──────────────── apps/web (Preact + signals, one Vite build) ────────────────┐
     │  App · Toolbar · Sidebar (mini month) · RangeView · Dialogs · StatusBar       │
     │  AppController (settings, view, anchor date, dialogs, notices)               │
     │  commands.ts (the catalog) · shortcuts.ts · nativeMenu.ts                    │
     └─────────────────────────────────────┬────────────────────────────────────────┘
                                           │ imports
     ┌──────────────────── packages/ui (Preact + signals) ─────────────────────┐
     │  CommandCatalog (keys, two-key sequences, recents) · listenForKeys        │
     │  Dialog · ListPopup · focusTrap · Icon · settings · schedule (timers)     │
     └─────────────────────────────────────┬───────────────────────────────────┘
                                           │
     ┌──────────────────── packages/core (pure TS) ────────────────────┐
     │  plainDate (calendar dates) · views (ranges, grids, titles)      │◄──── apps/cli
     │  colours (palette, accents, text on a colour)                    │
     └──────────────────────────────────────────────────────────────────┘
     ┌──────────── packages/node-files (Node) ────────────┐
     │  readTextFile · writeAtomic (versioned, atomic)    │◄──── apps/desktop, later apps/server and apps/cli
     └────────────────────────────────────────────────────┘
```

## Layering

- `packages/core` has no DOM and no Node APIs. ESLint rejects `window`, `document`, `localStorage` and `process` there, so the engine runs the same in a browser, the CLI and the tests.
- `packages/ui` knows the DOM but not where files live.
- `packages/node-files` is the only code that touches the disk.
- Other packages import only through `@daybird/<package>`, and tests only through their own package's `src/index.ts`; the architecture test rejects deep imports.
- `test/architecture.test.ts` also keeps platform APIs in one place each: key listeners in `packages/ui/src/commands/`, timers in `packages/ui/src/schedule.ts`, browser storage in `packages/ui/src/settings.ts`, and effect hooks in the dialog and popup components.

## Core (`packages/core`)

- `plainDate.ts`: calendar dates as `YYYY-MM-DD` strings, with arithmetic on whole days so a daylight-saving change can't move a date (PRD §4.1).
- `views.ts`: what each view shows: its date range, the month grid, stepping, and the title (PRD §6).
- `colours.ts`: the calendar palette and accent colours, and the text colour that reads on each (PRD §5.6).
- `ical/`: our own iCalendar reader and writer (PRD §3.2, §3.3). `contentLine.ts` parses and formats one line, folds at 75 octets and handles text escapes. `document.ts` reads a file into an immutable tree of components and properties in file order. Each node read from disk keeps its physical lines, so an unedited file writes back byte for byte; a changed node is written fresh. Lines it can't read are kept and written back as they were; a file whose structure is broken is refused with a line number. `calendarFile.ts` reads the name and colour, fills in missing UIDs and stamps PRODID. The fixture corpus is in `packages/core/test/fixtures/ical/`. `values.ts` reads and writes DATE, DATE-TIME, DURATION and PERIOD values; `vtimezone.ts` reads a VTIMEZONE into a zone and writes one for an IANA zone from the offsets `Intl` reports across a year.
- `time/`: wall-clock times and zones (PRD §4.3, §4.4). `dateTime.ts` holds `PlainDateTime` and local seconds, the wall clock counted as if it were UTC. `zones.ts` gives offsets for IANA zones from `Intl` (a table of transitions per zone and year, found by probing and bisecting) and for a file's own VTIMEZONE rules; it turns wall-clock times into instants, moving a time in a spring-forward gap forward and taking the earlier of a repeated time. `windowsZones.ts` is the CLDR Windows-to-IANA table. `rrule.ts` parses, writes and expands RRULEs on the wall clock with the 50,000 cap; `recurrenceSet.ts` adds RDATEs and takes away EXDATEs and EXRULEs; `ruleWords.ts` describes a rule in English.
- `model/`: calendars and edits (PRD §4.1, §4.2, §7, §8.2). A `Calendar` keeps its whole parsed file; `calendar.ts` groups its VEVENTs into series by UID. `event.ts` reads a VEVENT into fields and writes patches back in place. `occurrences.ts` expands series for a range; an occurrence is named by its key, its original start in wall-clock seconds in the master's frame. `seriesEdits.ts` makes This/Future/All changes on one series; `workspace.ts` applies them across calendars, stamps edited events and adds VTIMEZONEs. `trash.ts` reads and writes `.daybird/trash.ics`, `undo.ts` records which files a change touched, and `invariants.ts` checks the §4.2 rules after every random operation in tests.

## UI (`packages/ui`)

- `commands/`: the `CommandCatalog`. Shortcuts are parsed once; `forEvent` turns a key press into a command, a wait for the second key of a sequence, or nothing (PRD §12). `listenForKeys` is the one key listener.
- `settings.ts`: the per-device settings and where they are kept (PRD §13).
- `components/`: `Dialog` (modal, focus trap, Esc), `ListPopup` and the `Icon` set.

## Web shell (`apps/web`)

- `AppController` holds the app's state in signals: the settings, today's date, the anchor date the view shows, the open dialog and the status-bar notice. Components read it and call its methods; they keep no state of their own beyond small things such as which month the mini month shows.
- `main.tsx` wires the controller to the page: the theme and accent on `<html>`, the key listener, a 30-second tick that notices midnight, and, in the desktop app, the native bridge.

## Desktop (`apps/desktop`)

The Electron main process, a sandboxed preload with context isolation, and the `daybirdNative` bridge. The native menu bar is built from the command catalog and sent over IPC. `DAYBIRD_HEADLESS=1` runs it with no window or Dock icon, for automated checks.
