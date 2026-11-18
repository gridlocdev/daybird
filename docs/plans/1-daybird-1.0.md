# Daybird 1.0

Each slice leaves `just check` green and fits one session. "Waits on" names the slices it needs.

## Foundation

- [x] **1. Skeleton.** Workspace, `packages/core` and `packages/ui`, `apps/web` shell (toolbar, sidebar, status bar, empty view), `apps/desktop` with `DAYBIRD_HEADLESS=1`, `apps/server` and `apps/cli` stubs, command catalog with File/Edit/View/Go/Help, ⌘K, ⌘/, theme and accent, tokens (§5.1, §5.3, §12, §13 theme), justfile, AGENTS.md, architecture test, e2e setup, CI.
- [x] **2. iCalendar parse and write.** Unfold/fold, escapes, parameters, components kept in order, byte-identical round-trip, bad lines kept raw, unreadable files refused (§3.2, §3.3). Corpus of fixture files from Apple, Google, Outlook, Fastmail exports (made-up data). Waits on 1.
- [x] **3. Dates and time zones.** `PlainDate`, `PlainDateTime`, `ZonedDateTime` on `Intl`; gaps and overlaps; Windows→IANA table; VTIMEZONE read and write, including writing one for each TZID a file uses but doesn't define (§4.1, §4.3, §3.3). Waits on 1.
- [x] **4. Recurrence.** Full RRULE expander with RDATE/EXDATE/EXRULE, ranged expansion, the 50,000 cap, every RFC 5545 example, DST and leap cases, rule-to-words (§4.4, §8.1 words). Waits on 3.
- [ ] **5. Engine model and edits.** Calendars, series, overrides, occurrences for a range; create, edit, move, delete with This/Future/All; trash; undo steps; `checkInvariants` and random-operation tests; event ends from DTEND or DURATION, UID + RECURRENCE-ID identity, DTSTAMP/LAST-MODIFIED/SEQUENCE on edit (§3.2, §3.3, §4.1, §4.2, §7.6, §7.7, §8.2). Waits on 2, 4.

## Storage

- [ ] **6. Store interface.** Folder of files with per-file versions: `MemoryStore`, `BrowserStore` (File System Access + storage fallback), the contract test; save session statechart, retries, conflict dialog, recovery snapshot, outside-change pickup (§3.1, §3.4–§3.7). Waits on 5.
- [ ] **7. Desktop store and folder picking.** Node file store with atomic writes and lock files, Open Calendar Folder…, first-start folder offer (§3.7, §14). Waits on 6.

## Views

- [ ] **8. Week and Day views.** Time grid, all-day strip, now line, overlap layout, scrolling and zoom, range navigation and keys (§6.1, §6.5, §5.4). Waits on 6.
- [ ] **9. Month view.** Spanning bars, "N more" popover (§6.2). Waits on 8.
- [ ] **10. Sidebar.** Mini month, calendar list with show/hide, colours, new/rename/delete calendar, default calendar in the folder settings file, hidden calendars per device (§5.2, §5.6, §13). Waits on 8.
- [ ] **11. Year and Agenda views.** (§6.3, §6.4). Waits on 9.

## Editing

- [ ] **12. Create and popover editor.** Drag/double-click/⌘N create, the popover, one undo step per open, Escape on untouched new event (§7.1, §7.2, §7.4). Waits on 8.
- [ ] **13. Move, resize, keyboard moves, copy/paste/duplicate, context menus** (§7.3, §7.5, §12 menus). Waits on 12.
- [ ] **14. Repeat editing.** Repeat menu, Custom dialog, read-only complex rules, This/Future/All prompt (§8). Waits on 12, 5.
- [ ] **15. Time zone support setting** and display-zone picker (§4.3, §13). Waits on 12.
- [ ] **16. Trash view, search, import and export** (§7.7, §10, §11). Waits on 11, 12.
- [ ] **17. Reminders.** VALARM editing, scheduler, desktop and browser notifications, fired-once memory (§9). Waits on 12, 7.

## Shells and release

- [ ] **18. NAS server and Docker** (§15). Waits on 6.
- [ ] **19. CLI** (§16). Waits on 5, 7.
- [ ] **20. Native menu, Finder open, window state; icon; README and docs; first release** (§14). Waits on all.
