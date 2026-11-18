# Features

Daybird is a calendar that keeps each calendar in a plain `.ics` file. This page grows with each release; the [product requirements](plans/prd.md) describe everything planned for 1.0.

## Calendar views

Five views of the same calendars: **Day** and **Week** as a time grid, **Month** as a grid of weeks, **Year** as twelve small months, and **Agenda** as a list of the next 60 days. Switch with the buttons at the top right, the View menu, or a single key (**D**, **W**, **M**, **Y**, **A**). Daybird remembers the last view.

## Week and Day

Week and Day draw a time grid with an all-day strip on top. Events that overlap sit side by side, an event that runs past midnight shows in both days, and a red line marks the time now in today's column. The grid opens just before now, or at the first hour you set. **⌘=** and **⌘-** (**Ctrl+=** and **Ctrl+-**) make the hours taller or shorter, and Daybird remembers it. Click an event to select it.

## Month

Month shows whole weeks that stretch to fill the window. All-day and multi-day events are bars that wrap at the end of a week, and other events are one line each with a colour dot, the start time and the title. When a day has more than fits, "N more" lists the whole day. Click a day number to open that day.

## Sidebar calendars

The sidebar lists every calendar in the folder. Its checkbox, in the calendar's colour, shows or hides the calendar's events on this device only. **+** beside the heading (or **⌥⌘N**, **Ctrl+Alt+N**) adds a calendar in a file of its own. Right-click a calendar, or use the **⋯** on its row, to rename it, change its colour, make it the default for new events, or delete it. Renaming and colour changes can be undone; deleting asks first and moves the file to the folder's `.daybird/trash`. The default calendar is kept in the folder, so every device that opens it uses the same one. A file Daybird can't read shows greyed, with the reason on hover. Days with events have a dot in the mini month, and the sidebar's edge drags (or takes **←** and **→**) to make it wider or narrower.

## Year and Agenda

Year shows the twelve months of the year, each day tinted by how busy it is, in four steps from none to six or more events, with today ringed. Click a day to open it. Agenda lists every event from the chosen day on, grouped under day headings ("Today", "Tomorrow", "Thursday, November 19") with the time, a colour dot, the title and the location; days with nothing are left out. Scroll to the end, or click **Show 60 More Days**, to see further ahead, and **Show Earlier** at the top to look back. Click a row to select the event.

## Moving through time

The arrows beside **Today** move one day, week, month or year at a time, by the view, and **Today** comes back. The title says which range you are looking at. The sidebar's mini month shades that range; click a day there, or in the Year view, to show it.

## Command menu and shortcuts

**⌘K** (**Ctrl+K**) opens the command menu: type part of a command's name and press Return. **⌘/** (**Ctrl+/**) lists every shortcut, and [Controls](controls.md) has the same list.

## Appearance

Settings (**⌘,** or **Ctrl+,**) chooses light, dark or the system's appearance, an accent colour, the first day of the week (or your region's), and whether to show week numbers.

## Saving

Every change is saved as soon as you make it, and **⌘Z** (**Ctrl+Z**) takes it back. If a calendar file changes somewhere else while this window has changes to it that aren't saved yet, Daybird asks what to keep: your version as a copy, your version over theirs, or theirs. Changes made in other apps show up when you come back to the window. If a window closes before it can save, the next one offers to put those changes back. The desktop app keeps each calendar as an `.ics` file in a folder you choose: on first start it offers Documents/Daybird, and **Open Calendar Folder…** (**⌘O**) switches to another. In a browser that can't open a folder, calendars are kept in the browser itself, and the status bar says so.

## Desktop, browser and NAS

The same app runs as a desktop app for macOS, Windows and Linux, in a browser, and from a NAS server you host yourself. The desktop app has a native menu bar with every command, and on a Mac its toolbar sits in the title bar.
