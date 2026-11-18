/**
 * Ringing reminders (PRD §9). While a window is open, reminders of the shown calendars ring at their time: a
 * notice in the status bar with Show, and a system notification when Settings allow one. A reminder missed
 * while no window was open rings once if it's less than an hour old. Each rings once per device, and only one
 * window rings them.
 */
import { effect } from '@preact/signals';
import {
  REMINDER_LAG_SECONDS,
  REMINDER_LEAD_SECONDS,
  formatPlainDate,
  remindersDue,
  timeLabel,
  todayIn,
  type DueReminder,
  type Occurrence,
} from '@daybird/core';
import { after, type FiredReminders } from '@daybird/ui';
import type { AppController } from './controller.ts';
import { HOUR12 } from './eventParts.tsx';

/** How old a missed reminder may be and still ring. */
const CATCH_UP_SECONDS = 3600;
/** The longest wait between looks, so a change that adds a reminder soon is never far off. */
const LOOK_SECONDS = 60;
/** How far ahead each look reaches. */
const AHEAD_SECONDS = 24 * 3600;
const LOCK = 'daybird-reminders';

/** What a system notification says. */
export interface ReminderMessage {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

/** "Today at 3:00 PM · Room 4", "Wednesday, Nov 18 · All day". */
export function reminderMessage(app: AppController, due: DueReminder): ReminderMessage {
  const o = due.occurrence;
  const zone = app.displayZone;
  const day = todayIn(o.start * 1000, zone);
  const today = app.today.peek();
  const date =
    day === today
      ? 'Today'
      : formatPlainDate(day, app.locale, { weekday: 'long', month: 'short', day: 'numeric' });
  const time = o.allDay
    ? `${date}, all day`
    : `${date} at ${timeLabel(o.start, app.locale, zone, HOUR12[app.settings.peek().timeFormat])}`;
  return { id: due.id, title: o.title || 'New Event', body: o.location ? `${time} · ${o.location}` : time };
}

/** Show: the event's day in Day view, with the event selected. */
export function showOccurrence(app: AppController, o: Occurrence): void {
  app.openDay(todayIn(o.start * 1000, app.displayZone));
  app.select({ calendarId: o.calendarId, uid: o.uid, key: o.key });
}

/** Rings reminders from now on. `system` puts up a notification outside the window, when allowed. */
export function startReminders(
  app: AppController,
  fired: FiredReminders,
  system: (message: ReminderMessage, show: () => void) => void,
): void {
  const ring = (due: DueReminder) => {
    const message = reminderMessage(app, due);
    const show = () => showOccurrence(app, due.occurrence);
    app.say(`${message.title}: ${message.body}`, { sticky: true, action: { label: 'Show', run: show } });
    if (app.settings.peek().notifications) system(message, show);
  };
  const begin = () => {
    let since = Math.floor(Date.now() / 1000) - CATCH_UP_SECONDS;
    let cancel: (() => void) | null = null;
    const look = () => {
      cancel?.();
      // Until the calendars are read there's nothing to ring, and the hour of catching up waits for them.
      if (!app.session.peek()) return;
      const now = Math.floor(Date.now() / 1000);
      since = Math.max(since, now - CATCH_UP_SECONDS);
      const occurrences = app.occurrencesBetween(
        since - REMINDER_LAG_SECONDS,
        now + AHEAD_SECONDS + REMINDER_LEAD_SECONDS,
      );
      for (const due of remindersDue(occurrences, since, now)) {
        if (fired.has(due.id)) continue;
        fired.add(due.id, due.at, now);
        ring(due);
      }
      since = now;
      const next = remindersDue(occurrences, now, now + AHEAD_SECONDS)[0];
      const wait = Math.min(LOOK_SECONDS, Math.max(1, (next?.at ?? now + LOOK_SECONDS) - now));
      cancel = after(wait * 1000, look);
    };
    // Looks again whenever the shown calendars or the display zone change.
    effect(() => {
      void app.session.value;
      void app.shownCalendars.value;
      void app.settings.value.displayZone;
      look();
    });
  };
  const locks = (navigator as Partial<Navigator>).locks;
  if (!locks) {
    begin();
    return;
  }
  // The window that holds the lock rings; when it closes, the next one takes over.
  void locks.request(LOCK, () => {
    begin();
    return new Promise<never>(() => {});
  });
}

/** Rings in the browser through the Notification API, when the user allowed it. */
export function browserNotification(message: ReminderMessage, show: () => void): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const n = new Notification(message.title, { body: message.body, tag: message.id });
  n.onclick = () => {
    window.focus();
    show();
    n.close();
  };
}

/** Settings' Show notifications in the browser: turning it on asks the browser first. */
export async function allowBrowserNotifications(app: AppController, on: boolean): Promise<void> {
  if (!on || typeof Notification === 'undefined') {
    app.update({ notifications: on });
    return;
  }
  const answer = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  app.update({ notifications: answer === 'granted' });
  if (answer !== 'granted')
    app.say('The browser won’t show notifications for Daybird. Its site settings can allow them.', {
      tone: 'error',
    });
}

/** Whether Settings shows Show notifications as on: in the browser, only once the browser allows them too. */
export function notificationsOn(app: AppController, native: boolean): boolean {
  const on = app.settings.value.notifications;
  if (native) return on;
  return on && typeof Notification !== 'undefined' && Notification.permission === 'granted';
}
