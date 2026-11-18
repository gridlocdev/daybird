# Daybird — product requirements

Daybird is a calendar for one person. It runs as a desktop app (Electron), in the browser, from a self-hosted NAS server, and as a `daybird` command line, all on the same engine and the same folder of calendar files. Code cites this document as `PRD §n`.

## §1 Goals

1. See the day, week, month or year at a glance, and move through time without the mouse.
2. Make an event by dragging across the time it takes, and change it by dragging it.
3. Keep calendars as standard iCalendar (`.ics`) files that other calendar apps open, and round-trip everything Daybird doesn't understand.
4. Repeat events with any rule RFC 5545 allows, in any time zone, and show them correctly across daylight-saving changes.
5. Never lose an event: atomic saves, conflicts shown and chosen by the user, a Trash, undo for every change.

## §2 Non-goals for 1.0

- Accounts, sharing, invitations (no ATTENDEE replies, no iMIP email), free/busy.
- CalDAV, Google or iCloud sync. Subscribing to remote `.ics` URLs (a later release; §11 import covers one-off holiday files).
- Tasks (VTODO) and journals (VJOURNAL): read and written back untouched, never shown.
- Natural-language quick add ("Lunch Fri 1pm") is a post-1.0 slice, not part of 1.0.
- Attachments, travel time, locations on a map.
- Push notifications from the NAS server (§9).

## §3 Data

### §3.1 The calendar folder

- The user picks one folder. Each `*.ics` file directly in it is one calendar. Subfolders are ignored, except `.daybird/` (below).
- A calendar's name is its `X-WR-CALNAME`, or the file name without `.ics` when that's missing. Its colour is `X-APPLE-CALENDAR-COLOR` (`#RRGGBB`, the property Apple Calendar reads and writes); a missing or unreadable colour gets the next unused colour from §5.6.
- A new calendar is written as `<name>.ics`, with characters not allowed in file names replaced by `-`, and ` 2`, ` 3`… added when the name is taken. Renaming a calendar changes `X-WR-CALNAME` only, never the file name, so other programs keep their path.
- An empty folder gets one calendar, `Calendar.ics`, on first start (no welcome card).
- `.daybird/settings.json` holds the settings that follow the folder (§13): the default calendar. `.daybird/trash.ics` holds deleted events (§7.7). `.daybird/trash/` holds deleted calendar files. A `trash.ics` Daybird can't read is moved aside as `.daybird/trash unreadable <YYYY-MM-DD-HHmmss>.ics`, never written over, and a new trash starts.

### §3.2 Reading a calendar file

- Daybird parses RFC 5545 itself: line unfolding (CRLF or LF, a leading space or tab), escaped text (`\n \, \; \\`), parameters with quoted values, multiple values, and UTF-8 with or without a byte-order mark.
- Components: `VEVENT` is shown. `VTIMEZONE` is used for time zones (§4.3). `VALARM` inside an event is a reminder (§9). Every other component (`VTODO`, `VJOURNAL`, `VFREEBUSY`, `X-` components) and every property and parameter Daybird doesn't use is kept in order and written back unchanged.
- An event is identified by `UID`, plus `RECURRENCE-ID` for a changed occurrence of a repeating event (§8). An event without a `UID` gets one on reading, and the file is marked as changed so the next save writes it.
- `DTEND` or `DURATION` give the end. Neither: a timed event lasts zero minutes, an all-day event one day. An end before the start is read as the start (zero length), and the event's popover says "The end was before the start, so it was set to the start." until it's edited.
- A file that can't be parsed (no `BEGIN:VCALENDAR`, unbalanced `BEGIN`/`END`) is never written by Daybird. The calendar shows in the sidebar greyed, with "Can't read <file>" and the parse error's line number; its events don't show. The file is left exactly as it is.
- A single bad line (an unparseable date, say) skips that property, keeps the raw line for writing back, and the event's popover lists what couldn't be read.

### §3.3 Writing a calendar file

- Written with CRLF line endings, lines folded at 75 octets without splitting a UTF-8 character, `PRODID:-//Daybird//Daybird <version>//EN`, `VERSION:2.0`.
- Properties Daybird changed are written in a fixed order; properties and components it kept are written where they were. A file read and written with no edits is byte-identical, apart from line endings and folding when the original used LF or long lines.
- Each event Daybird edits gets `DTSTAMP` and `LAST-MODIFIED` set to now (UTC) and `SEQUENCE` raised by one when its time or rule changes.
- `VTIMEZONE` components are written for every `TZID` an event uses that the file doesn't already define (§4.3), and unused ones Daybird added are left in (other apps may need them).

### §3.4 Saving

- Every change is saved immediately. Each calendar file saves on its own; saves to one file never overlap (a change during a save is saved right after it).
- Saves are atomic: write a temp file next to it, flush, rename over the file. A symlink stays a symlink.
- The desktop app, the NAS server and the CLI hold a lock file (`.<name>.ics.lock`) while checking the version and writing; a lock older than 10 s is taken over. Browser tabs use a Web Lock.
- A failed save is retried twice (300 ms, 600 ms), then the status bar shows "Couldn't save <calendar>." with **Try Again** until a save works, then "Saved." The unsaved calendar is kept in the browser's storage until then (§3.6).
- Settings changes are saved but aren't undo steps.

### §3.5 Versions and conflicts

- Every read returns a version per file (SHA-256 of its bytes). Every save sends the version last read or written; a different version on disk fails the save with a conflict.
- The conflict dialog, "<Calendar> changed somewhere else", says how many events differ and offers **Save Mine as a Copy** (default: write `<name> copy <YYYY-MM-DD-HHmmss>.ics`, which then shows as its own calendar, and load the file on disk), **Keep Mine** and **Use Theirs**. Nothing merges, nothing overwrites without the user choosing.
- The copy is named "<name> copy" and gets the next unused colour. It is written before anything is taken from disk, so a copy that can't be written leaves the dialog open.
- A file deleted elsewhere under unsaved changes opens the same dialog, "<Calendar> was deleted somewhere else": **Save Mine as a Copy** writes the copy and removes the calendar, **Keep Mine** writes the file again, and **Use Theirs** removes the calendar. While the dialog is open, edits go on and are kept; nothing is saved to that file until the user chooses.
- Changes made elsewhere (Apple Calendar, the CLI, another window) are picked up when the window comes to the front and every 15 s while it's in front, file by file. A changed file with nothing unsaved in this window is taken as one undo step, with "Updated <calendar> with N changes made elsewhere." and Undo. New `.ics` files appear as calendars; a removed file removes its calendar with "<Calendar> was removed from the folder." (no undo: the file is gone).

### §3.6 Recovery

- Every 30 s while anything is unsaved, and on closing, the unsaved calendars are written to the browser's storage (desktop: the app's data folder) as a snapshot.
- On start, a snapshot newer than its file opens the recovery dialog: **Restore** (shows the snapshot as unsaved changes, then saves through the normal conflict check) or **Discard**. Restore is the default. Restore is one undo step, "Restore Unsaved Changes". Nothing in the offered files is saved until the user chooses. A snapshot left by a window that is still open is never offered.

### §3.7 Where the folder lives

- Desktop: chosen with **Open Calendar Folder…** (⌘O); the last one reopens, remembered in `folder.json` in the app's data folder. First start asks before showing any calendar: **Use Documents/Daybird** (created when chosen) or **Choose Folder…**. When the remembered folder is gone (an unplugged drive), the same question names it and nothing is created in its place. Switching folders waits up to 5 s for the old folder's saves; if they haven't landed it says so and stays. The status bar shows the folder's name, with its path on hover.
- Desktop files are written to a temporary file beside the target and renamed over it, so a crash leaves the old file or the new one. A save holds a `.<name>.lock` file next to the target while it checks the version and writes, so the CLI and the NAS server never write the same file at once; a lock older than 10 s is taken as left by a crash, and a save that can't get the lock in 12 s fails with "is being saved by another program". Paths outside the folder, `..` and symlinks that lead out are refused. A closing window waits up to 2.5 s for saves, then keeps a recovery snapshot of anything still unsaved (§3.6).
- Browser: the File System Access API folder, where the browser has it; otherwise calendars live in the browser's storage, and **Export All** (§11) is the way out. The status bar says "Stored in this browser" in that case.
- NAS: the folder the server is started with (§15).

## §4 Engine

### §4.1 Model

- `Calendar`: `id` (file name), `name`, `color`, `readOnly` (an unreadable file), `components` (kept as parsed, §3.2), `events`.
- `EventSeries`: one `UID`: the master `VEVENT` (or none, when a file has only overrides) and its overrides keyed by `RECURRENCE-ID`.
- `Occurrence` (computed, never stored): series UID, recurrence id, calendar id, start and end as instants plus the zone they're shown in, `allDay`, and the fields shown (title, location, notes, URL, colour, reminders).
- Dates are `Temporal`-free: the engine has its own `PlainDate` (`YYYY-MM-DD`), `PlainDateTime`, and `ZonedDateTime` (a plain date-time plus a zone id), converted with `Intl.DateTimeFormat` offsets. No `Date` arithmetic in local time.

### §4.2 Invariants (checked by `checkInvariants` in tests)

- One series per UID per calendar. A UID in two calendars is allowed (other apps do it) but moving an event never creates a duplicate.
- Every override's `RECURRENCE-ID` matches an occurrence of its master's rule, or the master has an `RDATE` for it, or the master is missing.
- `EXDATE` and overrides never both name the same occurrence.
- An all-day event's start and end are dates, a timed event's are date-times, never mixed.
- Trash entries name the calendar they came from; restoring into a calendar that no longer exists goes to the default calendar.
- An edit that changes nothing records no undo step and doesn't save.

### §4.3 Time zones

- A `TZID` that's an IANA name (`Europe/London`) is used as is. A Windows name (`Pacific Standard Time`) is mapped through the CLDR table to IANA. Any other `TZID` uses the file's `VTIMEZONE` rules. A `TZID` with none of these is read as floating and the event's popover says "Unknown time zone <TZID>; shown in local time."
- UTC times (`Z`) stay UTC. Floating times (no zone) show at the same clock time in every zone.
- Times show in the display zone: the system zone, or the one chosen in Settings (§13). An event in another zone shows its own zone and clock time in the popover ("9:00 AM New York").
- A time that doesn't exist (inside a spring-forward gap) moves forward by the gap; a repeated time (fall-back) takes the earlier one. RFC 5545 §3.3.5.
- New events use the display zone. Writing a `VTIMEZONE` for an IANA zone builds `STANDARD`/`DAYLIGHT` rules from the offsets `Intl` reports, probed across the event's year.

### §4.4 Recurrence

- Full RFC 5545 `RRULE`: `FREQ` (secondly through yearly), `INTERVAL`, `COUNT`, `UNTIL`, `BYSECOND`, `BYMINUTE`, `BYHOUR`, `BYDAY` (with ordinals, `-1SU`), `BYMONTHDAY` (negative too), `BYYEARDAY`, `BYWEEKNO`, `BYMONTH`, `BYSETPOS`, `WKST`. Plus `RDATE`, `EXDATE` and the deprecated `EXRULE` (read and applied, never written).
- Occurrences are expanded only for the range being shown, from the series start, in the event's own zone, so a 9:00 weekly event stays at 9:00 across daylight-saving changes.
- Invalid dates are skipped, not clamped (RFC 5545: `BYMONTHDAY=31` skips 30-day months). `SECONDLY` and `MINUTELY` rules show but the editor can't make them.
- Expansion stops after 50,000 candidate instants per series per range. A series that hits it shows the occurrences found, and its popover says "This event repeats too often to show every time."
- Tested against every example in RFC 5545 §3.8.5.3, plus daylight-saving and leap-year cases.

## §5 Layout and look

Design direction, from reviewing Apple Calendar, Fantastical, Google Calendar and Notion Calendar, and Daybird's sibling apps:

- **Time is the content.** The grid fills the window. Chrome is one toolbar row and a sidebar that can hide. No ribbon, no tabs.
- **Keyboard-first like Notion Calendar**, mouse-complete like Apple Calendar: single keys for views and navigation, ⌘K for everything (§12).
- **Edit in place.** A popover beside the event, not a modal sheet. The popover is the editor; there's no separate inspector.
- **Colour belongs to calendars.** Events take their calendar's colour; the chrome stays neutral grey with one accent for selection, focus and "now".

### §5.1 Window

- One toolbar row across the top. On macOS it's the title bar (hidden title bar, traffic lights inset), and empty toolbar space drags the window.
- Toolbar, left to right: sidebar toggle; the range title ("November 2026", "Nov 16 – 22, 2026", "Tuesday, November 17, 2026"; bold month, light year); ‹ **Today** ›; flexible space; the view switcher (Day, Week, Month, Year, Agenda, as a segmented control); the search field; **+** (new event).
- Below: the sidebar (left) and the view.
- A status bar along the bottom holds notices (§5.5) and the save state. It's 24 px and empty most of the time.

### §5.2 Sidebar

- 240 px wide, resizable 200–360 px, hidden with ⌘⌥S (remembered).
- Top: a mini month. Today ringed in the accent; the days in the shown range shaded; days with events get a small dot below the number. Arrows move it a month without moving the view; clicking a day shows that day in the current view (Month view goes to that month).
- Below: **Calendars**, one row each: a checkbox in the calendar's colour (shown/hidden), the name, and on hover a ⋯ button (the same items as right-click: Show Calendar, Rename, Colour, Set as Default, Export, Delete Calendar). The default calendar shows "Default" in grey. **+** beside the heading (⌥⌘N) adds a calendar, `Untitled` when the name is left empty, in a new file named after it.
- Rename and Colour change the calendar inside its file (`X-WR-CALNAME`, `X-APPLE-CALENDAR-COLOR`) and are undo steps; the file keeps its name. New Calendar and Delete Calendar are not undo steps: undoing a new calendar would leave its file behind. Delete asks first ("Delete Work?", with its event count) and moves the file to `.daybird/trash/<name> <YYYY-MM-DD-HHmmss>.ics`; an unreadable calendar goes without asking. The last calendar new events could go to can't be deleted, and a calendar mid-save asks to try again.
- The sidebar's right edge drags to resize it, and takes ← → (⇧ for bigger steps) when focused; a double-click puts it back to 240 px.
- A greyed row for an unreadable file (§3.2), with its error on hover.
- Bottom: **Trash** with its count when non-zero.

### §5.3 Theme and tokens

- Light, dark, and auto (follows the system); the `data-theme` attribute on `<html>`. Tokens prefixed `--db-`, light on `:root`, dark under the `prefers-color-scheme` media query guarded by `:root:not([data-theme='light'])` and repeated under `:root[data-theme='dark']`.
- Window, sidebar and chrome are layered greys (sidebar a shade off the grid); the grid is the lightest surface. Accent: blue by default, chosen in Settings from blue, red, orange, green, teal, purple, pink; tints come from `color-mix`.
- The system font stack, 13 px UI. Event titles 12 px semibold; times tabular numerals.
- Reduced motion: no slide between ranges, no popover scale-in.

### §5.4 Event chips

- Timed events in Day and Week: a block with a 3 px left bar in the calendar colour, a fill of that colour at 18% (32% in dark mode) and text in a darkened (lightened in dark mode) version of it. Title, then the time when the block is 30 minutes or taller (beside the title under 45 minutes, where the time gives way first in a narrow column; under it from 45), then the location from an hour. Past events fade to 60%. A screen reader hears "Title, 9:00 AM to 10:00 AM, Location, Calendar, repeats".
- All-day events: a filled bar in the calendar colour with white text, or black on light colours (relative luminance above 0.4, such as the palette's yellow).
- Selected: a 2 px accent ring. Being dragged: a shadow and the original's place drawn dashed.
- Repeating events show ↻ after the title; events with reminders don't get an icon.

### §5.5 Notices

- No toasts. One notice at a time in the status bar, cleared after 6 s (12 s with an action such as Undo), or by the next notice. Errors stay until resolved and use the error colour. Every notice is also read out through a polite live region.

### §5.6 Colours

- The palette for new calendars, in order: blue `#1f77d0`, red `#e5484d`, orange `#f76808`, yellow `#e2a300`, green `#30a46c`, teal `#12a594`, purple `#8e4ec6`, pink `#d6409f`, brown `#a07553`, gray `#8b8d98`. **Custom…** opens the system colour picker. A colour from a file that isn't in the palette is kept exactly.

## §6 Views

All views share: the shown date (the anchor), the selected occurrence (at most one), and the display zone. The view and anchor are remembered per device; the app opens on the last view at today.

### §6.1 Day and Week

- An all-day strip on top (grows to 4 rows; past that it shows 3 and a "+N more" per day, which expands it, and "Less" folds it again), then a 24-hour time grid with hour labels at the left, half-hour lines lighter.
- Week starts on the locale's first day, or the Settings choice. Weekend columns a shade darker. Today's column header in the accent. Optional week numbers (ISO 8601) at the top left.
- The red "now" line with a dot at the left edge of today's column, updated every 30 s. At midnight the views roll over (today moves).
- Opening a range scrolls to 30 minutes before now when today is shown, else to the first visible hour setting (default 8:00). Hour height 48 px; ⌘+ / ⌘− zoom 32–96 px (remembered).
- Overlapping events split the column: each cluster of overlapping events gets as many columns as its widest moment, events placed left-first in start order (ties: longer first), each widened right into free columns. Events shorter than 15 minutes draw 15 minutes tall.
- An event crossing midnight draws in both columns, its edges squared where it continues.
- Day view is the same grid with one column, with the selected event's details in the popover only.
- Clicking an event selects it (one at a time, in every view).

### §6.2 Month

- A 6-week grid (5 when the month fits in 5 without hiding a week). Day numbers at the top right of each cell; the 1st shows the month name ("Dec 1"); today's number in an accent circle; days outside the month greyed.
- All-day and multi-day events are bars that span their days and wrap at week ends. Timed events are lines: a dot in the calendar colour, the start time, the title. Sorted all-day first, then by start.
- A cell shows as many as fit; the rest become "N more", which opens a list of everything on the day (picking one selects it; **Show Day** opens Day view). A bar shows only where every day it crosses has room for it, so a bar is never cut short without a "N more" saying so. Clicking a day number opens Day view on it.
- Rows stretch to fill the window height.
- Month view pages a month at a time, like every other view, rather than scrolling by week: the range title always matches what's on screen, and ‹ › mean the same thing in every view.

### §6.3 Year

- Twelve mini months in a grid (4×3, or 3×4 / 2×6 when narrow). Each day tinted by how many events it has (0, 1–2, 3–5, 6+ in four steps of the accent). Today ringed. The sidebar's mini month marks busy days with a dot instead of a tint.
- Clicking a day opens Day view on it; clicking a month name opens Month view.

### §6.4 Agenda

- A list of occurrences starting at the anchor (today when opened from **Today**), grouped under sticky day headings ("Today", "Tomorrow", "Thursday, November 19"); days with nothing are skipped. Each row: time range (or "All day"), colour dot, title, location.
- Loads 60 more days when the end of the list scrolls into view, or with **Show 60 More Days** beside "Up to <date>" at the end. **Show Earlier** at the top adds the 60 days before, shown faded like past events elsewhere, so looking back is possible but never the first thing seen. A new anchor (**Today**, ‹ ›, a date in the mini month) starts the list again at it. Empty: "No events in the next N days. The list reaches <date>." Clicking a row selects the event.
- Search results use the same list (§10).

### §6.5 Moving through time

- ‹ and › move by the view's unit (day, week, month, year; Agenda by a week). **Today** goes to today. **Go to Date…** (G) takes a typed date in the locale's format, or a weekday, "tomorrow", "next friday".
- Scroll and swipe: the trackpad scrolls the time grid vertically only; horizontal swipes don't change the range (no accidental jumps). Month and Year don't scroll.

## §7 Events

### §7.1 Creating

- Drag on empty grid in Day or Week: snaps to 15 minutes; dragging up from the start works too; Escape cancels. Release creates "New Event" in the default calendar for the dragged time and opens the popover with the title selected.
- Click on empty grid: selects nothing. Double-click: a 1-hour event (or the default length, §13) at the clicked quarter hour.
- Drag in the all-day strip or across Month cells: an all-day event over those days. Double-click a Month cell: an all-day event that day.
- ⌘N or N: a new event at the next half hour today (or the anchor day, when today isn't shown), default length, default calendar, popover open.
- A new event that's left with title "New Event" and nothing else changed is still kept (Apple Calendar does the same); Escape on a just-created untouched event deletes it without a Trash entry and without an undo step.

### §7.2 The event popover

- Opens beside the event (right, else left, else below), with an arrow at it. Escape, a click outside, or Enter in the title closes it. Every change saves as you go, with the whole open-to-close as one undo step.
- Fields: title; location; all-day toggle; start and end (date and time; changing the start moves the end to keep the length); time zone (shown only when "Time zone support" is on in Settings, or the event already has a zone other than the display zone); repeat (§8.1); calendar (coloured menu); reminders (§9); URL; notes (plain text, multi-line).
- A repeating occurrence's changes are held until the popover closes, then the This/Future/All question (§8.2) applies them at once; Cancel drops them. A calendar that can't be changed shows its fields disabled.
- Footer: **Delete** and **Done**. Read-only fields (from an unreadable property, §3.2) list below.
- Tab order follows the fields; the first field focused is the title.

### §7.3 Moving and resizing

- Drag an event in Day or Week to move it (15-minute snap, across days, into or out of the all-day strip, which toggles all-day: an all-day event dropped on the grid becomes the default length). Drag its bottom edge to change the end; Shift-drag the top edge to change the start.
- Drag in Month moves by days, keeping times.
- Option-drag copies.
- Arrow keys on a selected event: ↑/↓ move it 15 minutes (Shift: 1 hour) in Day and Week; ←/→ a day. In Month ↑/↓ move a week.
- Moving a repeating event asks (§8.2).

### §7.4 Selecting

- Click selects; the selection follows Tab / Shift-Tab through the visible events in time order. Enter opens the popover; Escape clears the selection.

### §7.5 Copy, cut, paste, duplicate

- ⌘C copies the selected event (as iCalendar text too, so it pastes into other apps). ⌘X cuts (to Trash, one undo step). ⌘V pastes at the same time on the anchor day, or at the hovered time in Day/Week. ⌘D duplicates in place, one day later in Month.

### §7.6 Undo

- Every change is an undo step (⌘Z, ⇧⌘Z). Undo restores the calendar files as they were and saves. The notice for a change names it ("Moved Lunch to Thursday", Undo). The stack holds 200 steps and clears when a conflict takes the file on disk.

### §7.7 Trash

- Deleting an event (Delete or ⌫ on a selection, the popover's Delete, the context menu) moves the series or occurrence to `.daybird/trash.ics` with `X-DAYBIRD-CALENDAR` (the file name) and `X-DAYBIRD-DELETED` (UTC). Each deletion is one entry: its VEVENTs share `X-DAYBIRD-ENTRY`, and `X-DAYBIRD-KIND` says whether it was a series, a skipped occurrence or a changed occurrence. Restoring a skipped occurrence removes its `EXDATE`; when its series is gone it comes back as a single event. A restored series whose UID is taken gets a new one. No confirmation; the notice "Deleted Lunch." with Undo.
- Deleting a calendar asks "Delete <name> and its N events?" and moves its file to `.daybird/trash/<file> <YYYY-MM-DD-HHmmss>.ics`.
- The Trash view lists deleted events and calendars, newest first, with **Restore** and **Delete Permanently** (asks), and **Empty Trash** (asks, names the count, "can't be undone").
- Items deleted more than 30 days ago are removed when the folder loads.

## §8 Repeating events

### §8.1 The repeat field

- Menu: Never, Every Day, Every Weekday, Every Week, Every 2 Weeks, Every Month, Every Year, Custom…, and the event's own rule described in words when it's none of these ("Every month on the last Friday").
- Custom… opens a small dialog: every N day(s) / week(s) / month(s) / year(s); weekly: which weekdays; monthly: "on day 17" or "on the third Tuesday" or "on the last day"; yearly: which months, and optionally "on the third Tuesday"; end: never, on a date, after N times.
- A rule the dialog can't show (`BYSETPOS` combinations, `BYHOUR` lists, `BYWEEKNO`, secondly/minutely) shows read-only in words with **Replace with a Simple Rule**. Its other fields stay editable.
- Rules are described in words by the engine, in English for 1.0.

### §8.2 Changing one or all

- Editing, moving or deleting an occurrence of a repeating event asks: **This Event**, **This and Future Events**, **All Events**, Cancel. The popover asks once when it closes, for all changes made while it was open.
- This Event: an override with `RECURRENCE-ID` (or an `EXDATE` for delete).
- This and Future: the master's rule ends (`UNTIL`) before this occurrence, and a new series with a new UID starts here with the changes. Overrides after the split move to the new series.
- All Events: changes the master; a time change moves overrides that kept the master's old time by the same amount, and leaves overrides the user moved. A new time is taken as made on the occurrence before any override moved it. A change of title, location, notes, URL or reminders also reaches overrides that hadn't changed that field. The occurrence the change was made on takes the whole change. Overrides and skipped dates the new rule no longer makes are dropped.
- Moving one occurrence of a repeating event to another calendar (This Event) skips it in its series and makes it a single event in the other calendar. All Events moves the series; This and Future moves the new series.
- Deleting the first occurrence with This Event is an `EXDATE`, not a change of `DTSTART`.

## §9 Reminders

- An event's `VALARM`s with `ACTION:DISPLAY` or `AUDIO` show as reminders; other actions (`EMAIL`) are kept but not shown or fired.
- The popover offers: none, at time of event, 5, 10, 15, 30 minutes, 1 hour, 2 hours, 1 day, 2 days, 1 week before; Custom (minutes/hours/days before); all-day events: on the day at 9:00, the day before at 9:00, a week before at 9:00. Up to 5 per event.
- Desktop: a native notification at the time, with the title, time and location; clicking it shows the event. Reminders missed while the app was closed fire once on start if they're less than 1 hour old, else they're skipped silently.
- Browser: the Notification API while a tab is open, after the user turns on "Show notifications" in Settings (which asks the browser's permission). Only one tab fires (Web Lock).
- Firing is scheduled for the next 24 hours and recomputed on every change and at midnight. A fired reminder is remembered per device so it never fires twice. `ACKNOWLEDGED` is not written in 1.0.

## §10 Search

- ⌘F or / focuses the search field. Typing filters occurrences by title, location and notes (case- and accent-insensitive), shown in the Agenda list, from a year back to two years ahead, nearest first. Enter shows the first in its day; Escape clears and returns to the previous view.
- Empty: "No events match "<text>"."

## §11 Import and export

- **Import…** reads an `.ics` file and asks which calendar to add its events to (or a new one named after the file). Events whose UID already exists in that calendar are skipped, and the notice says "Imported N events (M already there)." with Undo.
- **Export Calendar…** saves a copy of one calendar file. **Export All…** saves a `.zip` of every calendar (browser storage) — desktop and NAS users have the folder itself.

## §12 Commands and keys

Every action is a command in one catalog feeding the keyboard, ⌘K, context menus, the native menu bar, toolbar buttons, the Keyboard Shortcuts window (⌘/) and `docs/controls.md`. Single-letter keys work only when focus isn't in a text field.

| Key               | Command                                              |
| ----------------- | ---------------------------------------------------- |
| D / W / M / Y / A | Day / Week / Month / Year / Agenda view (also ⌘1–⌘5) |
| T                 | Today                                                |
| ← → or J K        | Previous / next range (when no event is selected)    |
| G                 | Go to Date…                                          |
| N, ⌘N             | New Event                                            |
| ⇧⌘N               | New Calendar                                         |
| Enter             | Open the selected event                              |
| Delete, ⌫         | Delete the selected event                            |
| ⌘C ⌘X ⌘V ⌘D       | Copy, cut, paste, duplicate                          |
| ⌘Z ⇧⌘Z            | Undo, redo                                           |
| ⌘F, /             | Search                                               |
| ⌘K                | Command menu                                         |
| ⌘/                | Keyboard Shortcuts                                   |
| ⌘⌥S               | Show/hide sidebar                                    |
| ⌘+ ⌘−             | Zoom the time grid                                   |
| ⌘,                | Settings                                             |
| ⌘O                | Open Calendar Folder… (desktop)                      |
| ⇧⌘I               | Import…                                              |

Context menus: an event (Open, Cut, Copy, Duplicate, Calendar ▸, Delete); empty grid (New Event Here, Paste); a calendar row (Rename, Colour ▸, Set as Default, Show Only This Calendar, Export, Delete Calendar); the Trash row (Empty Trash).

## §13 Settings

- Per device: theme (auto, light, dark), accent, week starts on (locale default, Sunday, Monday, Saturday), first visible hour, hour height, show week numbers, time format (locale default, 12-hour, 24-hour), time zone support (off: everything in the system zone; on: the zone field and a display-zone picker), default event length (15, 30, 45, 60, 90, 120 minutes), show notifications, last view and anchor, sidebar width and shown.
- Per device as well: hidden calendars. Hiding is a way of looking, like the view, so hiding Work on the laptop leaves it shown on the NAS. A hidden calendar's events don't show anywhere in that window, search included; its sidebar row stays, unchecked. A calendar whose file is new to this device is shown.
- In the folder (`.daybird/settings.json`, follows the data): the default calendar, so a new event lands in the same calendar from the desktop, the browser, the NAS and the CLI. A default that names a missing file falls back to the first calendar by name.

## §14 Desktop

- Electron, the shared static build, a hidden title bar with inset traffic lights on macOS. Native menu from the catalog (Daybird, File, Edit, View, Go, Window, Help).
- `DAYBIRD_HEADLESS=1` runs it with no window shown, for checks. `DAYBIRD_USER_DATA`, `DAYBIRD_DOCUMENTS` and `DAYBIRD_FOLDER` move its own files, the Documents folder it offers and the calendar folder, so checks never touch the owner's.
- Window size and position remembered. Closing the last window quits on Windows and Linux, stays in the Dock on macOS. Reminders keep firing while the app runs with no window on macOS.
- Opening an `.ics` file from Finder imports it (§11), asking which calendar.

## §15 NAS server

- `daybird-server --dir <folder> --port <n>` serves the web build and the folder's calendars over the same store interface, with version tokens and the lock file. No accounts; meant behind the user's reverse proxy. Docker image and compose example as for the other apps.

## §16 CLI

- `daybird` on the same engine, against a folder (`--dir`, default the desktop app's last folder):
  - `list [--from date] [--to date] [--calendar name] [--json]`: occurrences in a range (default: today).
  - `add "<title>" --start <date-time> [--end|--duration] [--all-day] [--calendar] [--rrule] [--location]`.
  - `edit <uid> …`, `delete <uid> [--occurrence <date-time>]` (to the Trash).
  - `calendars` lists calendars; `import <file> --calendar <name>`; `export <calendar>`.
- Exit codes: 0 ok, 1 error (message on stderr), 2 conflict after retrying once.

## §17 Accessibility

- The time grid is a `grid` with labelled cells; events are buttons labelled "Lunch, Tuesday November 17, 12:00 to 1:00 PM, Work calendar, repeats". Every drag has a keyboard equivalent (§7.3). Focus is always visible. Colour is never the only signal (selected and today also differ in weight and ring). Contrast AA in both themes.

## §18 Decisions and the heuristics behind them

The open questions from planning were settled with Nielsen's usability heuristics:

1. **Hidden calendars per device, default calendar in the folder** (§13). Hiding is a view choice (user control and freedom: one device's choice doesn't reach into another's). The default calendar decides where data goes, so it follows the data (consistency and standards across the four ways in).
2. **Agenda starts at the anchor, scrolls back into the past** (§6.4). Starting at today shows what matters now (aesthetic and minimalist design); scrolling up is the natural way to look back (recognition rather than recall), and faded past events keep the boundary visible (visibility of system status).
3. **Month view pages by month** (§6.2). The title always matches the grid (visibility of system status) and ‹ › behave the same in every view (consistency and standards).
