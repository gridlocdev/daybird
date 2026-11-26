# Daybird glossary

Daybird is a keyboard-first calendar whose data is a folder of iCalendar files, shared by the desktop app, the browser, a NAS server and the command line.

## Language

### Data

**Calendar folder**: The one folder Daybird works on: each `.ics` file directly in it is a **Calendar**, and its `.daybird/` subfolder holds the **Trash** and the folder's settings. _Avoid_: library, vault, workspace, data folder

**Calendar**: One `.ics` file in the **Calendar folder**, with a name and a colour stored inside the file. Its `id` in the code is the file name. _Avoid_: file (when you mean what the user sees), list, account

**Default calendar**: The **Calendar** new **Events** go to. It is stored in the **Calendar folder**, so every platform uses the same one. _Avoid_: primary calendar, main calendar

**Unreadable calendar**: A **Calendar** whose file Daybird can't parse. It shows greyed with its error, and Daybird never writes to it (`readOnly` in the code). _Avoid_: broken calendar, corrupt calendar

**Event**: What the user sees and edits: one entry in a **Calendar** with a title, a time and optional details. A repeating event is a **Series**; each time it happens is an **Occurrence**. _Avoid_: appointment, item, entry, meeting

**Series**: All of an **Event**'s data under one `UID`: the master `VEVENT` with its **Repeat** rule, and its **Overrides** (`EventSeries` in the code). _Avoid_: recurring event (in code and specs), master (for the whole series)

**Occurrence**: One time a **Series** happens, worked out for the range shown and never stored. _Avoid_: instance, recurrence

**Repeat**: The rule that makes a **Series** happen more than once, shown in words ("Every month on the last Friday"). The file stores it as `RRULE`, `RDATE` and `EXDATE`. _Avoid_: recurrence (in the UI), rule (on its own)

**Override**: An **Occurrence** changed on its own with **This Event**, stored as a `VEVENT` with a `RECURRENCE-ID`. The Trash calls it a changed occurrence. _Avoid_: exception, detached instance

**Skipped occurrence**: An **Occurrence** deleted on its own with **This Event**, stored as an `EXDATE`. _Avoid_: excluded date, cancelled occurrence

**All-day event**: An **Event** whose start and end are dates, not times. It shows in the all-day strip and as a bar in Month. _Avoid_: full-day event, date event

**Reminder**: An alert on an **Event** (a `VALARM` that displays or plays a sound) that rings at a set time before it. _Avoid_: alarm, alert, notification (the notification is how a reminder rings)

### Time

**Display zone**: The time zone Daybird shows times in: the system zone, or the one chosen while **Time zone support** is on. _Avoid_: local zone, current zone, view zone

**Floating time**: A time with no zone, shown at the same clock time in every **Display zone**. _Avoid_: local time, naive time

**Time zone support**: The setting that shows each **Event**'s own zone and lets the user pick the **Display zone**. Off, everything shows in the system zone. _Avoid_: multiple time zones, zone mode

### Views

**View**: One way of showing time: Day, Week, Month, Year or Agenda. Search results and the Trash take the view's place but aren't views. _Avoid_: mode, tab, page, layout

**Anchor**: The date the **View** is showing, shared by every view. ‹ › move it by the view's unit and **Today** sets it to today. _Avoid_: current date, focus date, cursor

**Range**: The dates a **View** shows around the **Anchor**, named by the range title in the toolbar ("Nov 15 – 21, 2026"). _Avoid_: period, span, window

**Mini month**: The small month grid at the top of the **Sidebar**, and each of the twelve in Year view. _Avoid_: date picker, small calendar

**Sidebar**: The left column with the **Mini month**, the list of **Calendars** and the **Trash** row. _Avoid_: drawer, panel, source list

**Selection**: The one **Occurrence** that is selected, if any, shared by every **View**. Arrow keys move it, Enter opens its **Popover**. _Avoid_: focus (focus is the keyboard's; it follows the selection), highlight, active event

**Popover**: The editor that opens beside an **Event**. It saves as you type, and everything from opening to closing is one **Undo step**. _Avoid_: inspector, sheet, modal, event dialog

**Chip**: How an **Occurrence** is drawn in a **View**: a block in Day and Week, a bar or a line in Month (PRD §5.4). The word is used in specs and code only. _Avoid_: card, tile, pill

### Commands

**Command**: One action in the catalog, with a title, an optional **Shortcut** and a check for whether it can run now. Every menu, key and button runs a command. _Avoid_: action, menu item

**Command menu**: The searchable list of every **Command** (⌘K or Ctrl+K), titled **Command Menu…** in the app. _Avoid_: command palette, launcher, quick open

**Shortcut**: The key or keys bound to a **Command**: a modified key (⌘Z), a single key (N) or a sequence. _Avoid_: hotkey, keybinding, accelerator (except for Electron's menu API)

**Keyboard Shortcuts window**: The dialog (⌘/) that lists every **Shortcut** and has **Press a Shortcut…** to look up a key. _Avoid_: cheat sheet, help window

### Saving and safety

**Notice**: The one message at a time in the status bar, sometimes with an action such as Undo or **Try Again**. _Avoid_: toast, snackbar, alert, banner

**Undo step**: One change that ⌘Z takes back as a whole. Settings changes and new or deleted **Calendars** aren't undo steps. _Avoid_: history entry, transaction

**Trash**: Where deleted **Events** and **Calendars** go: `.daybird/trash.ics` for events, `.daybird/trash/` for calendar files. Items older than 30 days are removed. _Avoid_: bin, recycle bin, deleted items, archive

**Version**: The SHA-256 of a **Calendar** file's bytes as last read or written. A save sends it, and a different version on disk is a **Conflict**. _Avoid_: revision, etag, hash (in specs)

**Conflict**: A **Calendar** that changed or was deleted somewhere else while this window had unsaved changes to it. The user chooses **Save Mine as a Copy**, **Keep Mine** or **Use Theirs**; nothing merges. _Avoid_: merge conflict, sync error, clash

**Snapshot**: The copy of unsaved **Calendars** kept in the browser's storage (or the desktop app's data folder) every 30 s and on closing, offered back by the recovery dialog. _Avoid_: backup, autosave, draft

**Read-only folder**: A **Calendar folder** opened in Firefox or Safari, which can read the files but not save to them, so every **Command** that writes is off. _Avoid_: view-only, locked folder

### Settings

**Device setting**: A setting kept per device and browser: theme, accent, week start, time format, hidden **Calendars**, the last **View** and **Anchor**. _Avoid_: local setting, preference (on its own)

**Folder setting**: A setting kept in the **Calendar folder** (`.daybird/settings.json`) so it follows the data: the **Default calendar**. _Avoid_: shared setting, synced setting

## Relationships

- A **Calendar folder** holds many **Calendars** and one **Trash**.
- A **Calendar** holds many **Series**; a `UID` names at most one **Series** per **Calendar**.
- A **Series** has one **Repeat** at most, and zero or more **Overrides** and **Skipped occurrences**.
- A **Series** makes one **Occurrence** per time its **Repeat** gives, or exactly one when it has none.
- Every **View** shows one **Range**, worked out from the **Anchor**; the **Anchor**, the **Selection** and the **Display zone** are shared by all views.
- Every key, menu item, context menu entry and toolbar button runs one **Command**; a **Command** has zero or more **Shortcuts**.
- A **Popover** edits one **Occurrence**; closing it makes one **Undo step** (and asks This Event, This and Future Events, or All Events when the event repeats).

## Flagged ambiguities

- "Event" meant both the whole repeating thing and each time it happens. Resolved: the user-facing word stays **Event**; in code and specs the stored thing is a **Series** and each time is an **Occurrence**.
- "Recurrence" meant both the rule and a single occurrence (as in `RECURRENCE-ID`). Resolved: the rule is a **Repeat**, each time is an **Occurrence**, and "recurrence" is kept only inside iCalendar property names.
- "Focus" meant both the keyboard focus and the date being shown. Resolved: the shown date is the **Anchor**, the chosen event is the **Selection**, and "focus" means only keyboard focus.
- "Read-only" meant both a **Calendar** Daybird can't parse and a folder the browser can't save to. Resolved: the first is an **Unreadable calendar**, the second a **Read-only folder**.
- "Default" meant both the **Default calendar** and built-in setting values. Resolved: "default" on its own means the **Default calendar** in the UI; setting values say "Region default" or the value itself.
