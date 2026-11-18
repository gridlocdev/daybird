import { afterEach, describe, expect, it } from 'vitest';
import { FIRED_KEEP_SECONDS, localFiredReminders, memoryFiredReminders } from '@daybird/ui';

describe('fired reminders', () => {
  afterEach(() => globalThis.localStorage?.clear());

  it('remembers a rung reminder and forgets old ones', () => {
    const fired = memoryFiredReminders();
    fired.add('a', 100, 100);
    expect(fired.has('a')).toBe(true);
    fired.add('b', 100 + FIRED_KEEP_SECONDS + 1, 100 + FIRED_KEEP_SECONDS + 1);
    expect(fired.has('a')).toBe(false);
    expect(fired.has('b')).toBe(true);
  });

  it('works where the browser keeps nothing', () => {
    const fired = localFiredReminders();
    fired.add('a', 100, 100);
    expect(fired.has('a')).toBe(true);
  });
});
