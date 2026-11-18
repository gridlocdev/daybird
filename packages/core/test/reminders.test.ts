import { describe, expect, it } from 'vitest';
import {
  customReminder,
  loadCalendar,
  occurrencesIn,
  readEvent,
  reminderAmount,
  reminderChoices,
  reminderWords,
  remindersDue,
  seriesOf,
  withPatch,
  type Reminder,
} from '@daybird/core';

function calendar(...events: string[][]) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//Test//EN'];
  for (const e of events) lines.push('BEGIN:VEVENT', ...e, 'END:VEVENT');
  lines.push('END:VCALENDAR');
  return loadCalendar('Work.ics', `${lines.join('\r\n')}\r\n`, () => 'uid', []).calendar;
}

const alarm = (trigger: string, action = 'DISPLAY') => [
  'BEGIN:VALARM',
  `ACTION:${action}`,
  'DESCRIPTION:Reminder',
  trigger,
  'END:VALARM',
];

const utc = (iso: string) => Date.parse(iso) / 1000;
const format = { dateTime: (s: number) => new Date(s * 1000).toISOString(), nine: '9:00 AM' };

describe('reminders', () => {
  it('reads triggers before, after, from the end and at an instant, and skips email', () => {
    const c = calendar([
      'UID:a',
      'DTSTART:20261117T150000Z',
      'DTEND:20261117T160000Z',
      ...alarm('TRIGGER:-PT15M'),
      ...alarm('TRIGGER;RELATED=END:-PT5M'),
      ...alarm('TRIGGER:PT10M', 'AUDIO'),
      ...alarm('TRIGGER;VALUE=DATE-TIME:20261117T080000Z'),
      ...alarm('TRIGGER:-PT1H', 'EMAIL'),
    ]);
    const info = readEvent(seriesOf(c.document)[0]!.master!);
    expect(info.reminders.map((r) => reminderWords(r, false, format))).toEqual([
      '15 minutes before',
      '5 minutes before the end',
      '10 minutes after the start',
      'On 2026-11-17T08:00:00.000Z',
    ]);
  });

  it('writes RELATED=END back and keeps an email alarm', () => {
    const c = calendar([
      'UID:a',
      'DTSTART:20261117T150000Z',
      ...alarm('TRIGGER;RELATED=END:-PT5M'),
      ...alarm('TRIGGER:-PT1H', 'EMAIL'),
    ]);
    const master = seriesOf(c.document)[0]!.master!;
    const next: Reminder[] = [...readEvent(master).reminders, { kind: 'before', seconds: 600 }];
    const out = withPatch(master, { reminders: next });
    expect(readEvent(out).reminders).toEqual(next);
    expect(out.children.filter((n) => n.kind === 'component')).toHaveLength(3);
  });

  it('words the all-day choices at 9:00 and custom amounts in the largest unit', () => {
    expect(reminderChoices(true).map((r) => reminderWords(r, true, format))).toEqual([
      'On the day at 9:00 AM',
      'The day before at 9:00 AM',
      'A week before at 9:00 AM',
    ]);
    expect(reminderChoices(false).map((r) => reminderWords(r, false, format))).toContain('2 hours before');
    expect(reminderWords(customReminder(3, 'days'), false, format)).toBe('3 days before');
    expect(reminderAmount(90 * 60)).toEqual({ amount: 90, unit: 'minutes' });
    expect(reminderAmount(14 * 86400)).toEqual({ amount: 2, unit: 'weeks' });
  });

  it('finds the reminders that ring in a stretch, each occurrence its own', () => {
    const c = calendar(
      [
        'UID:daily',
        'DTSTART:20261117T150000Z',
        'DTEND:20261117T160000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
        ...alarm('TRIGGER:-PT15M'),
      ],
      ['UID:allday', 'DTSTART;VALUE=DATE:20261118', ...alarm('TRIGGER:PT9H')],
    );
    const os = occurrencesIn([c], utc('2026-11-15T00:00:00Z'), utc('2026-12-30T00:00:00Z'), 'UTC');
    const due = remindersDue(os, utc('2026-11-17T14:00:00Z'), utc('2026-11-18T14:00:00Z'));
    expect(due.map((d) => [new Date(d.at * 1000).toISOString(), d.occurrence.uid])).toEqual([
      ['2026-11-17T14:45:00.000Z', 'daily'],
      ['2026-11-18T09:00:00.000Z', 'allday'],
    ]);
    expect(new Set(remindersDue(os, 0, utc('2027-01-01T00:00:00Z')).map((d) => d.id)).size).toBe(4);
  });
});
