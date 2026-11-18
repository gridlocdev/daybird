import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  calendarColour,
  calendarName,
  componentNode,
  components,
  escapeText,
  fold,
  formatContentLine,
  paramValue,
  parseContentLine,
  properties,
  property,
  propertyNode,
  readCalendar,
  splitTextList,
  unescapeText,
  utf8Length,
  withCalendarName,
  withDaybirdStamp,
  withEventUids,
  withProperty,
  withoutProperty,
  writeCalendar,
  type CalendarNode,
  type ComponentNode,
} from '@daybird/core';

const FIXTURES = new URL('./fixtures/ical/', import.meta.url);
const EXPORTS = ['apple.ics', 'google.ics', 'outlook.ics', 'fastmail.ics'];

function fixture(name: string): string {
  return readFileSync(new URL(name, FIXTURES), 'utf8');
}

function read(text: string): ComponentNode {
  const result = readCalendar(text);
  if (!result.ok) throw new Error(`line ${result.error.line}: ${result.error.message}`);
  return result.calendar;
}

/** The tree with every node's lines from disk dropped, so writing it folds everything afresh. */
function fresh(node: CalendarNode): CalendarNode {
  if (node.kind === 'invalid') return node;
  if (node.kind === 'property') return { ...node, raw: null, line: 0 };
  return { ...node, begin: null, end: null, line: 0, children: node.children.map(fresh) };
}

/** What a tree means, without where its lines were or how they were folded. */
function shape(node: CalendarNode): unknown {
  if (node.kind === 'invalid') return { invalid: node.raw.join('') };
  if (node.kind === 'property') return [node.name, node.params, node.value];
  return { [node.name]: node.children.map(shape) };
}

/** A small seeded generator (mulberry32), so failures repeat. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('content lines', () => {
  it('reads names, quoted and repeated parameters and the value', () => {
    const parsed = parseContentLine(
      'attendee;cn="Ashby, Robin";member="mailto:a@example.com","mailto:b@example.com";ROLE=CHAIR:mailto:robin@example.com',
    );
    expect(parsed).toEqual({
      ok: true,
      line: {
        name: 'ATTENDEE',
        params: [
          { name: 'CN', values: ['Ashby, Robin'] },
          { name: 'MEMBER', values: ['mailto:a@example.com', 'mailto:b@example.com'] },
          { name: 'ROLE', values: ['CHAIR'] },
        ],
        value: 'mailto:robin@example.com',
      },
    });
  });

  it('keeps colons and semicolons in the value', () => {
    const parsed = parseContentLine('DESCRIPTION:Time: 10:30; bring tea');
    expect(parsed.ok && parsed.line.value).toBe('Time: 10:30; bring tea');
  });

  it('reads empty values and empty parameter values', () => {
    expect(parseContentLine('LOCATION:')).toMatchObject({ ok: true, line: { value: '' } });
    expect(parseContentLine('X-A;X-B=:v')).toMatchObject({
      ok: true,
      line: { params: [{ name: 'X-B', values: [''] }] },
    });
  });

  it('decodes RFC 6868 caret escapes in parameters, and writes them back', () => {
    const parsed = parseContentLine('X-T;X-P="a^nb ^\'quoted^\' ^^":v');
    expect(parsed.ok && parsed.line.params[0]?.values[0]).toBe('a\nb "quoted" ^');
    if (parsed.ok) expect(parseContentLine(formatContentLine(parsed.line))).toEqual(parsed);
  });

  it.each([
    ['', 'The line has no property name.'],
    ['NO COLON HERE', '"NO COLON HERE" isn\'t a property name.'],
    ['SUMMARY', 'The line has no ":" before its value.'],
    ['SUMMARY;LANGUAGE="en:x', 'The parameter LANGUAGE opens a quote that never closes.'],
    ['SUMMARY;LANGUAGE:x', 'The parameter LANGUAGE has no value.'],
    ['SUMMARY;=x:y', '"" isn\'t a parameter name.'],
    ['SUMMARY;A="x"y:z', 'The parameter A has text after its closing quote.'],
    ['SUMMARY;A=x"y:z', 'The parameter A has a quote inside its value.'],
  ])('refuses %j', (text, message) => {
    expect(parseContentLine(text)).toEqual({ ok: false, message });
  });

  it('quotes parameter values that hold ; : or ,', () => {
    const line = { name: 'X', params: [{ name: 'CN', values: ['Ashby, Robin', 'plain'] }], value: 'v' };
    expect(formatContentLine(line)).toBe('X;CN="Ashby, Robin",plain:v');
  });

  it('escapes and unescapes text', () => {
    expect(unescapeText(String.raw`a\, b\; c\\ d\nE\Nf\:g`)).toBe('a, b; c\\ d\nE\nf:g');
    expect(escapeText('a, b; c\\ d\r\ne\nf')).toBe(String.raw`a\, b\; c\\ d\ne\nf`);
    expect(splitTextList('Family,Birthday,Celebration\\, big')).toEqual([
      'Family',
      'Birthday',
      'Celebration, big',
    ]);
  });

  it('round-trips random text through escaping', () => {
    const next = random(2);
    const alphabet = ['a', ' ', ',', ';', '\\', '\n', ':', 'é', '🦉', 'n', 'N'];
    for (let i = 0; i < 500; i++) {
      const text = Array.from(
        { length: Math.floor(next() * 20) },
        () => alphabet[Math.floor(next() * alphabet.length)],
      ).join('');
      expect(unescapeText(escapeText(text))).toBe(text);
    }
  });
});

describe('folding', () => {
  it('folds at 75 octets, with the space counted on later lines', () => {
    const lines = fold(`DESCRIPTION:${'x'.repeat(200)}`);
    // 212 characters: 75 on the first line, then 74 after each leading space.
    expect(lines.map((l) => l.length)).toEqual([75, 75, 1 + 212 - 75 - 74]);
    expect(lines.slice(1).every((l) => l.startsWith(' '))).toBe(true);
  });

  it('never splits a UTF-8 character and never goes over 75 octets', () => {
    const next = random(1);
    const alphabet = ['a', 'é', '生', '🦉', '\u{1F468}‍\u{1F469}'];
    for (let i = 0; i < 500; i++) {
      const text = Array.from(
        { length: Math.floor(next() * 300) },
        () => alphabet[Math.floor(next() * alphabet.length)],
      ).join('');
      const lines = fold(`SUMMARY:${text}`);
      for (const l of lines) {
        expect(utf8Length(l)).toBeLessThanOrEqual(75);
        expect(l).not.toMatch(/[\uD800-\uDBFF]$/);
      }
      expect(lines.map((l, n) => (n === 0 ? l : l.slice(1))).join('')).toBe(`SUMMARY:${text}`);
    }
  });

  it('leaves short lines alone', () => {
    expect(fold('SUMMARY:Hi')).toEqual(['SUMMARY:Hi']);
    expect(fold(`X:${'y'.repeat(73)}`)).toHaveLength(1);
    expect(fold(`X:${'y'.repeat(74)}`)).toHaveLength(2);
  });
});

describe('reading and writing files', () => {
  it.each(EXPORTS)('writes %s back byte for byte', (name) => {
    const text = fixture(name);
    expect(writeCalendar(read(text))).toBe(text);
  });

  it.each(EXPORTS)('%s means the same after folding afresh', (name) => {
    const calendar = read(fixture(name));
    const rewritten = writeCalendar(fresh(calendar) as ComponentNode);
    for (const line of rewritten.split('\r\n')) expect(utf8Length(line)).toBeLessThanOrEqual(75);
    expect(shape(read(rewritten))).toEqual(shape(calendar));
  });

  it('keeps every component, known or not, in file order', () => {
    const calendar = read(fixture('fastmail.ics'));
    expect(
      calendar.children.filter((c) => c.kind === 'component').map((c) => (c as ComponentNode).name),
    ).toEqual(['VTIMEZONE', 'VEVENT', 'VEVENT', 'VTODO']);
    expect(components(calendar, 'VTODO')).toHaveLength(1);
  });

  it('unfolds long values and reads parameters from real-shaped exports', () => {
    const apple = read(fixture('apple.ics'));
    const event = components(apple, 'VEVENT')[0] as ComponentNode;
    expect(unescapeText(property(event, 'DESCRIPTION')?.value ?? '')).toBe(
      'Bring the long-handled fork and the seed potatoes. Check the water butt — it leaked last week.',
    );
    expect(unescapeText(property(event, 'LOCATION')?.value ?? '')).toBe(
      'Plot 14, Riverside Allotments\nMill Lane',
    );
    const where = property(event, 'X-APPLE-STRUCTURED-LOCATION');
    expect(where && paramValue(where, 'x-title')).toBe('Plot 14, Riverside Allotments');
    expect(where?.value).toBe('geo:51.501200,-0.142000');
    const google = read(fixture('google.ics'));
    const attendees = properties(components(google, 'VEVENT')[0] as ComponentNode, 'ATTENDEE');
    expect(attendees.map((a) => paramValue(a, 'CN'))).toEqual(['Ashby, Robin', 'sam@example.org']);
  });

  it('reads LF endings, a byte-order mark, tab folds and lower-case names', () => {
    const calendar = read(fixture('lf-bom.ics'));
    const event = components(calendar, 'VEVENT')[0] as ComponentNode;
    expect(property(event, 'SUMMARY')?.value).toBe('Tabfolded');
    expect(writeCalendar(calendar)).toBe(fixture('lf-bom.ics').slice(1).replaceAll('\n', '\r\n'));
  });

  it('skips lines it can’t read, reports them and writes them back', () => {
    const text = fixture('bad-lines.ics');
    const result = readCalendar(text);
    expect(result.ok && result.problems).toEqual([
      { line: 4, message: '"THIS LINE HAS NO COLON" isn\'t a property name.' },
      { line: 9, message: 'The parameter LANGUAGE opens a quote that never closes.' },
      { line: 10, message: '"" isn\'t a parameter name.' },
    ]);
    if (!result.ok) return;
    expect(
      properties(components(result.calendar, 'VEVENT')[0] as ComponentNode, 'SUMMARY').map((s) => s.value),
    ).toEqual(['Still readable']);
    expect(writeCalendar(result.calendar)).toBe(text);
  });

  it.each([
    ['unbalanced.ics', 7, "END:VEVENT doesn't match BEGIN:VALARM on line 5."],
    ['not-a-calendar.ics', 1, "The file doesn't start with BEGIN:VCALENDAR."],
  ])('refuses %s with the line it went wrong on', (name, line, message) => {
    expect(readCalendar(fixture(name))).toEqual({ ok: false, error: { line, message } });
  });

  it.each([
    ['', 1, "The file doesn't start with BEGIN:VCALENDAR."],
    ['SUMMARY:x\r\n', 1, "The file doesn't start with BEGIN:VCALENDAR."],
    ['BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n', 2, 'BEGIN:VEVENT on line 2 has no END:VEVENT.'],
    [
      'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\nBEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
      3,
      'The file holds more than one calendar.',
    ],
    ['BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\nX:y\r\n', 3, 'There is more in the file after END:VCALENDAR.'],
    ['BEGIN:VCALENDAR\r\nBEGIN:\r\n', 2, 'BEGIN has no component name.'],
    ['END:VCALENDAR\r\n', 1, 'END:VCALENDAR has no BEGIN before it.'],
  ])('refuses %j', (text, line, message) => {
    expect(readCalendar(text)).toEqual({ ok: false, error: { line, message } });
  });

  it('drops blank lines and still counts them for line numbers', () => {
    const result = readCalendar('BEGIN:VCALENDAR\r\n\r\nBAD\r\nEND:VCALENDAR\r\n');
    expect(result.ok && result.problems).toEqual([
      { line: 3, message: 'The line has no ":" before its value.' },
    ]);
  });
});

describe('editing the tree', () => {
  const event = componentNode('VEVENT', [
    propertyNode('UID', 'a@example.com'),
    propertyNode('SUMMARY', 'Tea'),
    propertyNode('X-CUSTOM', '1'),
    componentNode('VALARM', [propertyNode('ACTION', 'DISPLAY')]),
  ]);

  it('replaces a property where it stands', () => {
    const edited = withProperty(event, propertyNode('SUMMARY', 'Coffee'));
    expect(edited.children.map((c) => (c.kind === 'property' ? `${c.name}:${c.value}` : 'VALARM'))).toEqual([
      'UID:a@example.com',
      'SUMMARY:Coffee',
      'X-CUSTOM:1',
      'VALARM',
    ]);
  });

  it('returns the same component when nothing changes', () => {
    expect(withProperty(event, propertyNode('SUMMARY', 'Tea'))).toBe(event);
    expect(withoutProperty(event, 'LOCATION')).toBe(event);
  });

  it('inserts new properties in the house order, before subcomponents', () => {
    const edited = withProperty(
      withProperty(event, propertyNode('DTSTART', '20261117T100000Z')),
      propertyNode('X-NEW', 'z'),
    );
    expect(edited.children.map((c) => (c.kind === 'property' ? c.name : 'VALARM'))).toEqual([
      'UID',
      'SUMMARY',
      'DTSTART',
      'X-CUSTOM',
      'X-NEW',
      'VALARM',
    ]);
  });

  it('writes changed properties fresh and keeps the rest as they were', () => {
    const text = fixture('google.ics');
    const calendar = read(text);
    const edited = {
      ...calendar,
      children: calendar.children.map((c) =>
        c.kind === 'component' && c.name === 'VEVENT' && property(c, 'RRULE')
          ? withProperty(c, propertyNode('SUMMARY', 'Book club, at last'))
          : c,
      ),
    };
    const out = writeCalendar(edited);
    expect(out).toBe(
      text.replace(
        'SUMMARY:Book club\r\nTRANSP:OPAQUE\r\nBEGIN:VALARM',
        'SUMMARY:Book club, at last\r\nTRANSP:OPAQUE\r\nBEGIN:VALARM',
      ),
    );
  });
});

describe('calendar files', () => {
  it('names a calendar from X-WR-CALNAME, else its file', () => {
    expect(calendarName(read(fixture('apple.ics')), 'x.ics')).toBe('Allotment');
    expect(calendarName(read(fixture('no-uid.ics')), 'Hand Written.ics')).toBe('Hand Written');
    expect(calendarName(withCalendarName(read(fixture('no-uid.ics')), 'Tea, cake'), 'f.ics')).toBe(
      'Tea, cake',
    );
  });

  it('reads the Apple colour with or without alpha', () => {
    expect(calendarColour(read(fixture('apple.ics')))).toBe('#34aadc');
    expect(calendarColour(read(fixture('fastmail.ics')))).toBe('#e86e3a');
    expect(calendarColour(read(fixture('google.ics')))).toBeNull();
  });

  it('gives events without a UID one, and leaves the rest alone', () => {
    const calendar = read(fixture('no-uid.ics'));
    const fixed = withEventUids(calendar, () => 'new-uid@daybird');
    expect(property(components(fixed, 'VEVENT')[0] as ComponentNode, 'UID')?.value).toBe('new-uid@daybird');
    expect(writeCalendar(fixed)).toContain('BEGIN:VEVENT\r\nUID:new-uid@daybird\r\nDTSTAMP:');
    const complete = read(fixture('apple.ics'));
    expect(withEventUids(complete, () => 'unused')).toBe(complete);
  });

  it('stamps a changed file as written by Daybird', () => {
    const stamped = writeCalendar(withDaybirdStamp(read(fixture('apple.ics')), '1.2.3'));
    expect(stamped).toContain('\r\nVERSION:2.0\r\n');
    expect(stamped).toContain('\r\nPRODID:-//Daybird//Daybird 1.2.3//EN\r\n');
    expect(stamped).not.toContain('Apple Inc.');
    const bare = writeCalendar(withDaybirdStamp(componentNode('VCALENDAR'), '1.0.0'));
    expect(bare).toBe(
      'BEGIN:VCALENDAR\r\nPRODID:-//Daybird//Daybird 1.0.0//EN\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n',
    );
  });

  it('reads every fixture without surprises', () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.ics'));
    expect(files.length).toBeGreaterThanOrEqual(EXPORTS.length);
    for (const f of EXPORTS) expect(readCalendar(fixture(f))).toMatchObject({ ok: true, problems: [] });
  });
});
