# Daybird

Daybird is a calendar you can run almost entirely from the keyboard, on Linux, macOS or Windows. Each calendar is a plain `.ics` file in a folder you choose, so the desktop app, a browser, your NAS and the `daybird` command line all work on the same files.

![Daybird's week view of 15 to 21 November 2026. A sidebar on the left has a mini month with this week marked by a rounded grey band and today circled in blue, and two calendars, Home in green and Work in blue. The main grid shows seven days from 8 AM to 8 PM with timed events such as Team standup each weekday morning, Quarterly planning on Thursday and Choir practice on Wednesday evening, all-day events for Release day and Café brunch along the top, and a red line marking the time now on Tuesday.](docs/images/week-view.webp)

- **Keyboard first.** One key per view (**D**, **W**, **M**, **Y**, **A**), **J** and **K** to move through time, **N** for a new event, arrow keys to move it, and **Ctrl+K** (**⌘K** on a Mac) to run any command by name.
- **A real desktop app on Linux.** An AppImage for Linux, with the same menus, shortcuts and system notifications for reminders as on macOS and Windows.
- **Your files, not a database.** Standard iCalendar files that any other calendar app can read, with repeating events, time zones, reminders, a Trash and undo. Daybird never overwrites a change made elsewhere without asking.

## Getting started

Download the AppImage (Linux), `.dmg` (macOS) or installer (Windows) from the [latest release](../../releases/latest). On first start Daybird asks where to keep your calendars, `~/Documents/Daybird` by default.

See [Getting started](docs/getting-started.md) for running it from source, on a NAS with Docker, and the command line.

## Learn more

- [Features](docs/features.md) · [Controls](docs/controls.md) · [Working from the keyboard](docs/guides/working-from-the-keyboard.md)
- [All documentation](docs/README.md) · [Working on the code](docs/development.md)

## License

[MIT](LICENSE)
