# Daybird

Daybird is a calendar that keeps each of your calendars in a plain `.ics` file, in a folder you choose. Run it as a desktop app, in a browser, on your NAS, or from the terminal, all on the same files.

Daybird is under construction: the views and the keyboard work, and events come next. The [1.0 plan](docs/plans/1-daybird-1.0.md) lists what's left.

- **Five views.** Day, Week, Month, Year and Agenda, each one key away (**D**, **W**, **M**, **Y**, **A**).
- **Works from the keyboard.** **⌘K** runs any command, **T** goes to today, **←** and **→** move through time, and **⌘/** lists every shortcut.
- **Your files, not a database.** Standard iCalendar files that any other calendar app can read.

## Getting started

There is no release yet. To run it from source you need Node 22.18 or later, pnpm and [just](https://github.com/casey/just):

```bash
just setup
just run-web
```

## Documentation

- [Features](docs/features.md) and [Controls](docs/controls.md)
- [Development](docs/development.md) and [Architecture](docs/architecture.md)
- [Product requirements](docs/plans/prd.md)

## License

[MIT](LICENSE)
