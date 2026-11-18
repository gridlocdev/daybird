---
name: daybird
description: >-
  Read and change calendars kept as .ics files in a Daybird calendar folder with the `daybird` command-line tool: list events in a date range, add, change or delete events (one occurrence of a repeating event too), list calendars, and import or export .ics files. Use this whenever a task involves the user's Daybird calendars, a folder of .ics calendar files, scheduling or looking up events from a script, or "what's on my calendar".
---

# Working with calendars through `daybird`

`daybird` is the command-line face of the Daybird calendar app: the same engine, with no window. It works on a calendar folder, one `.ics` file per calendar. An open Daybird window picks up what it changes, and it never writes over a change the app made meanwhile. Run `daybird --help` for the commands and `daybird <command> --help` for each one's options.

## Prerequisite

`daybird` must be on `PATH`; check with `daybird --version`. Without `--dir` it uses `$DAYBIRD_DIR`, else the folder the Daybird desktop app opened last. If neither exists, ask the user which folder to use.

## Always

- Pass `--json` and read the reply as JSON. Errors are on stderr with exit 1; exit 2 means the calendars kept changing while saving, so read again and retry.
- Pass `--zone` with the user's IANA zone when it isn't this machine's. Times are typed and printed in that zone; a trailing `Z` means UTC.
- Look before you change: `daybird list --from <date> --to <date> --json` gives each event's `uid`, and `occurrence` for a repeating one.

## Commands

```bash
daybird calendars --json                                   # name, file, colour, events, readOnly, default
daybird list --json                                        # today
daybird list --from 2026-11-16 --to 2026-11-22 --calendar Work --json
daybird add "Dentist" --start 2026-11-20T15:30 --duration 45m --location "Main St" --json   # → {uid, calendar}
daybird add "Holiday" --start 2026-12-24 --end 2026-12-26 --calendar Home                  # all-day, last day included
daybird add "Standup" --start 2026-11-23T09:00 --duration 15m --rrule "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
daybird edit <uid> --title "New title" --start 2026-11-20T16:00   # keeps the length
daybird edit <uid> --occurrence 2026-11-25T09:00 --start 2026-11-25T10:00   # one occurrence only
daybird edit <uid> --calendar Home                         # move to another calendar
daybird edit <uid> --rrule none                            # stop repeating
daybird delete <uid>                                       # the whole event, to the Trash
daybird delete <uid> --occurrence 2026-11-25T09:00         # one occurrence
daybird import invite.ics --calendar Work --json           # → {calendar, added, skipped}
daybird export Work > Work.ics
```

## Gotchas

- A date without a time (`2026-11-20`) makes an all-day event. Its `--end` is the last day, not the day after.
- Without `--occurrence`, `edit` and `delete` act on every occurrence of a repeating event. `--occurrence` is the occurrence's original start, exactly as `list --json` prints it in `occurrence`.
- `--rrule` takes an RFC 5545 rule (`FREQ=MONTHLY;BYDAY=-1FR`) and always applies to the whole event.
- Deleted events go to Daybird's Trash, where the user can restore them for 30 days.
- Calendars are named by their name or file name, in any case. A calendar Daybird can't read is listed as read-only and never written.
