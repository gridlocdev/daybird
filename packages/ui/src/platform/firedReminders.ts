/**
 * Which reminders have rung on this device (PRD §9), so none rings twice: not after a reload, not in a second
 * window. Kept in `localStorage`, or in memory where the browser keeps nothing.
 */

/** How long a rung reminder is remembered after the time it rang. */
export const FIRED_KEEP_SECONDS = 3 * 24 * 3600;

export interface FiredReminders {
  has(id: string): boolean;
  /** Remembers a reminder that rang at `at` (UTC seconds) and forgets ones older than `FIRED_KEEP_SECONDS`. */
  add(id: string, at: number, now: number): void;
}

const KEY = 'daybird.firedReminders';

type Fired = Record<string, number>;

function parse(text: string | null): Fired {
  if (!text) return {};
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, at]) => typeof at === 'number')) as Fired;
  } catch {
    return {};
  }
}

const pruned = (fired: Fired, now: number): Fired =>
  Object.fromEntries(Object.entries(fired).filter(([, at]) => at >= now - FIRED_KEEP_SECONDS));

/** Fired reminders in memory, for tests and browsers that keep nothing. */
export function memoryFiredReminders(): FiredReminders {
  let fired: Fired = {};
  return {
    has: (id) => id in fired,
    add: (id, at, now) => {
      fired = { ...pruned(fired, now), [id]: at };
    },
  };
}

/** Fired reminders in `localStorage`, read fresh each time so two windows see each other's. */
export function localFiredReminders(): FiredReminders {
  const fallback = memoryFiredReminders();
  const read = (): Fired | null => {
    try {
      return parse(localStorage.getItem(KEY));
    } catch {
      return null;
    }
  };
  return {
    has: (id) => {
      const fired = read();
      return fired ? id in fired : fallback.has(id);
    },
    add: (id, at, now) => {
      fallback.add(id, at, now);
      const fired = read();
      if (!fired) return;
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...pruned(fired, now), [id]: at }));
      } catch (e) {
        console.warn('Could not remember a reminder that rang:', e);
      }
    },
  };
}
