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

## Creating and editing events

Drag down the Day or Week grid to make an event for that time, in 15-minute steps, or across the all-day strip or Month cells for an all-day event. Double-click empty space for an event of the default length, or press **N** or **⌘N** (**Ctrl+N**) for one at the next half hour. The new event opens in a popover with its title selected, so you can type straight away; **Escape** takes back a new event you haven't changed. Double-click an event, or select it and press **Enter**, to edit its title, place, times, calendar, URL and notes. Every change saves as you make it, and **⌘Z** undoes the whole visit at once. A change to a repeating event asks whether it's for this occurrence, this and the ones after, or all of them. **Delete** sends an event to the Trash, with Undo in the status bar.

## Moving and copying events

Drag an event to move it, in 15-minute steps, to another time or day, or into the all-day strip and back. In Month, dragging moves an event by days and keeps its time. Drag the bottom edge to change when it ends, Shift-drag the top edge to change when it starts, and hold Option (Alt) as you drag to leave the event where it was and drop a copy. A selected event moves with the arrow keys: **↑** and **↓** by 15 minutes (with **Shift**, an hour; in Month, a week), **←** and **→** by a day. **⌘C**, **⌘X** and **⌘V** copy, cut and paste (a copy also goes to the clipboard as a calendar file other apps can read), and **⌘D** duplicates. Right-click an event for Open, Cut, Copy, Duplicate and Delete, or empty grid for New Event Here and Paste.

## Repeating events

The popover's Repeat menu makes an event repeat every day, every weekday, every week, every two weeks, every month or every year. Custom… opens a dialog for every few days, weeks, months or years, which weekdays, a day of the month or "the third Tuesday", which months, and when it ends: never, on a date or after a number of times, with the rule in words as you choose. A rule the dialog can't show, such as "the last Monday or Tuesday of the month", stays in words with Replace with a Simple Rule. A change to the repeat of a repeating event asks whether it starts with this occurrence or covers all of them.

## Time zones

Every IANA time zone works, and times show in your system's zone. Turn on Time zone support in Settings to pick another zone to show times in, from Settings or the toolbar, and to give each event its own zone, or none so it stays at the same clock time everywhere. An event in another zone shows its own time in the popover, and keeps its zone when you drag it.

## Year and Agenda

Year shows the twelve months of the year, each day tinted by how busy it is, in four steps from none to six or more events, with today ringed. Click a day to open it. Agenda lists every event from the chosen day on, grouped under day headings ("Today", "Tomorrow", "Thursday, November 19") with the time, a colour dot, the title and the location; days with nothing are left out. Scroll to the end, or click **Show 60 More Days**, to see further ahead, and **Show Earlier** at the top to look back. Click a row to select the event.

## Search

Press **⌘F** (**Ctrl+F**) or **/** and type: the events whose title, place or notes have every word you typed, in any case and with or without accents, take the view's place, from a year ago to two years ahead, the nearest first. **Enter** shows the first one in its day; **Escape** clears the search and brings the view back.

## Trash

Deleted events and calendars go to the Trash under the calendars in the sidebar, and stay 30 days. The Trash lists them newest first, each with Restore, which puts it back where it was, and Delete Permanently. Right-click **Trash**, or use the button in the Trash, to empty it. A deleted calendar is still a file in the folder's `.daybird/trash` until then.

## Reminders

The popover's **Add Reminder** gives an event up to five reminders: at the time, minutes, hours or days before, or **Custom…** for any number of minutes, hours, days or weeks; an all-day event's ring at 9:00 on the day, the day before or a week before. While Daybird is open, a reminder shows in the status bar at its time with **Show**, which opens its event, and as a system notification when **Show notifications** is on in Settings (the browser asks first). A reminder missed while Daybird was closed rings when it opens if it's less than an hour old. Each rings once on a device, in one window.

## Import and export

**Import…** (**⇧⌘I**, **Ctrl+Shift+I**) reads an `.ics` file from another calendar app and adds its events to a calendar you choose, or to a new one named after the file; events already there are skipped, and Undo takes the import back. **Export Calendar…**, also in a calendar's menu, saves a copy of its file, and **Export All…** saves a `.zip` of every calendar.

## Moving through time

The arrows beside **Today** move one day, week, month or year at a time, by the view, and **Today** comes back. The title says which range you are looking at. The sidebar's mini month shades that range; click a day there, or in the Year view, to show it.

## Command menu and shortcuts

**⌘K** (**Ctrl+K**) opens the command menu: type part of a command's name and press Return. **⌘/** (**Ctrl+/**) lists every shortcut, and [Controls](controls.md) has the same list.

## Appearance

Settings (**⌘,** or **Ctrl+,**) chooses light, dark or the system's appearance, an accent colour, the first day of the week (or your region's), and whether to show week numbers.

## Saving

Every change is saved as soon as you make it, and **⌘Z** (**Ctrl+Z**) takes it back. If a calendar file changes somewhere else while this window has changes to it that aren't saved yet, Daybird asks what to keep: your version as a copy, your version over theirs, or theirs. Changes made in other apps show up when you come back to the window. If a window closes before it can save, the next one offers to put those changes back. The desktop app keeps each calendar as an `.ics` file in a folder you choose: on first start it offers Documents/Daybird, and **Open Calendar Folder…** (**⌘O**) switches to another. In a browser that can't open a folder, calendars are kept in the browser itself, and the status bar says so.

## NAS server

Run `daybird-server --dir <folder>` on a NAS, or the Docker image, and open it in any browser: every browser shares the calendars in that folder, and the status bar shows its name. Saves and changes made elsewhere work as in the desktop app, so the desktop app, the CLI and Apple Calendar can use the same folder over a network share. The server has no accounts; put it behind a reverse proxy that asks for a login.

## Desktop, browser and NAS

The same app runs as a desktop app for macOS, Windows and Linux, in a browser, and from a NAS server you host yourself. The desktop app has a native menu bar with every command, and on a Mac its toolbar sits in the title bar.
