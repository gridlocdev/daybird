# Changelog

## Unreleased

- The app shell: Day, Week, Month, Year and Agenda views with a toolbar to move through time, a sidebar with a mini month, the command menu (⌘K), the Keyboard Shortcuts window (⌘/), and Settings for appearance, accent colour, the first day of the week and week numbers.
- The desktop app for macOS, Windows and Linux, with a native menu bar.
- Daybird reads and writes `.ics` files itself. A file it hasn't changed is written back byte for byte, properties and components it doesn't know are kept, and a file it can't make sense of is refused with the line that went wrong.
- Time zones come from the system's own zone data, so every IANA zone works. Windows zone names in Outlook files are understood, a file's own VTIMEZONE is used when a name is unknown, and a VTIMEZONE is written for each zone a file needs.
- Repeating events follow every part of the iCalendar repeat rules, including extra and skipped dates, and a repeat is described in plain words such as "Every month on the last Friday".
- Events can be created, changed, moved between calendars and deleted, and a change to a repeating event can apply to one occurrence, to it and the ones after, or to all of them. Deleted events go to the Trash, and every change can be undone.
- Every change saves as soon as it's made, one file at a time, and a save that fails is retried and then offered again with Try Again. A calendar changed or deleted somewhere else while this window has unsaved changes opens a dialog to save a copy, keep this window's version or take the other one; nothing is overwritten without asking. Changes made elsewhere are picked up when the window comes to the front, and unsaved changes left by a closed window can be restored.
- Week and Day show events in a time grid: overlapping events side by side, all-day events in a strip on top, events past midnight in both days, and a line at the time now. Hours can be made taller or shorter.
- Month shows bars that wrap at week ends and a line for each timed event, as many as the window fits, with "N more" listing the rest of a day.
- The sidebar lists the calendars: show or hide each one on this device, add, rename, recolour and delete calendars, and pick the default calendar for new events, which every device opening the folder shares. Deleted calendar files go to the folder's `.daybird/trash`. The mini month marks days with events, and the sidebar can be resized.
- The desktop app keeps calendars in a folder you choose, Documents/Daybird by default, and Open Calendar Folder… switches to another. Saves are atomic and take turns with other programs saving the same file.
- In a browser without folder access, calendars are kept in the browser's own storage.
- The NAS server serves the web client, and the `daybird` command prints its help and version.
