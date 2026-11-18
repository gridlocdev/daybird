/**
 * An iCalendar file as a tree of components and properties, in file order (PRD §3.2, §3.3). Every node read
 * from disk keeps its physical lines, so a file read and written with no edits comes back byte for byte (with
 * CRLF line endings). A changed node drops them and is written fresh, folded at 75 octets. Lines that don't
 * parse are kept as they were and written back unchanged. Nodes are immutable: edits return new trees.
 */
import {
  fold,
  formatContentLine,
  parseContentLine,
  type ContentLine,
  type Parameter,
} from './contentLine.ts';

export interface PropertyNode extends ContentLine {
  readonly kind: 'property';
  /** The physical lines as read, or null for a new or changed property. */
  readonly raw: readonly string[] | null;
  /** The 1-based line the property starts on; 0 for one that wasn't read from a file. */
  readonly line: number;
}

/** A line that couldn't be read: skipped, but written back as it was. */
export interface InvalidNode {
  readonly kind: 'invalid';
  readonly raw: readonly string[];
  readonly line: number;
  readonly message: string;
}

export interface ComponentNode {
  readonly kind: 'component';
  /** Upper-cased: VCALENDAR, VEVENT, VTIMEZONE, VALARM… */
  readonly name: string;
  readonly children: readonly CalendarNode[];
  /** The BEGIN and END lines as read, or null for a new component. */
  readonly begin: readonly string[] | null;
  readonly end: readonly string[] | null;
  readonly line: number;
}

export type CalendarNode = PropertyNode | InvalidNode | ComponentNode;

export interface ReadProblem {
  readonly line: number;
  readonly message: string;
}

export type ReadResult =
  | {
      readonly ok: true;
      readonly calendar: ComponentNode;
      /** Lines that were skipped. The file can still be written. */
      readonly problems: readonly ReadProblem[];
    }
  | {
      readonly ok: false;
      /** Why the file can't be used. It's shown read-only and never written (PRD §3.2). */
      readonly error: ReadProblem;
    };

interface LogicalLine {
  text: string;
  readonly raw: string[];
  readonly line: number;
}

/** Joins folded lines: a line starting with a space or a tab continues the one before it. */
function unfold(text: string): LogicalLine[] {
  const physical = text.split(/\r\n|\n|\r/);
  const lines: LogicalLine[] = [];
  let current: LogicalLine | undefined;
  for (const [index, p] of physical.entries()) {
    if (current && (p.startsWith(' ') || p.startsWith('\t'))) {
      current.text += p.slice(1);
      current.raw.push(p);
      continue;
    }
    current = p === '' ? undefined : { text: p, raw: [p], line: index + 1 };
    if (current) lines.push(current);
  }
  return lines;
}

interface OpenComponent {
  readonly name: string;
  readonly children: CalendarNode[];
  readonly begin: string[];
  readonly line: number;
}

function failure(line: number, message: string): ReadResult {
  return { ok: false, error: { line, message } };
}

/** Reads a whole file. A byte-order mark and blank lines are dropped; LF and CR line endings are accepted. */
export function readCalendar(text: string): ReadResult {
  const lines = unfold(text.startsWith('﻿') ? text.slice(1) : text);
  const stack: OpenComponent[] = [];
  const problems: ReadProblem[] = [];
  let calendar: ComponentNode | null = null;
  for (const l of lines) {
    const parsed = parseContentLine(l.text);
    const marker =
      parsed.ok && (parsed.line.name === 'BEGIN' || parsed.line.name === 'END') ? parsed.line : null;
    const componentName = marker?.value.trim().toUpperCase() ?? '';
    if (calendar) {
      return failure(
        l.line,
        marker?.name === 'BEGIN' && componentName === 'VCALENDAR'
          ? 'The file holds more than one calendar.'
          : 'There is more in the file after END:VCALENDAR.',
      );
    }
    const top = stack.at(-1);
    if (marker) {
      if (!/^[A-Z0-9-]+$/.test(componentName))
        return failure(l.line, `${marker.name} has no component name.`);
      if (marker.name === 'BEGIN') {
        if (!top && componentName !== 'VCALENDAR') {
          return failure(l.line, "The file doesn't start with BEGIN:VCALENDAR.");
        }
        stack.push({ name: componentName, children: [], begin: l.raw, line: l.line });
        continue;
      }
      if (!top) return failure(l.line, `END:${componentName} has no BEGIN before it.`);
      if (top.name !== componentName) {
        return failure(l.line, `END:${componentName} doesn't match BEGIN:${top.name} on line ${top.line}.`);
      }
      stack.pop();
      const node: ComponentNode = { kind: 'component', ...top, end: l.raw };
      const parent = stack.at(-1);
      if (parent) parent.children.push(node);
      else calendar = node;
      continue;
    }
    if (!top) return failure(l.line, "The file doesn't start with BEGIN:VCALENDAR.");
    if (parsed.ok) {
      top.children.push({ kind: 'property', ...parsed.line, raw: l.raw, line: l.line });
    } else {
      top.children.push({ kind: 'invalid', raw: l.raw, line: l.line, message: parsed.message });
      problems.push({ line: l.line, message: parsed.message });
    }
  }
  const open = stack[0];
  if (open) {
    const last = stack.at(-1) ?? open;
    return failure(last.line, `BEGIN:${last.name} on line ${last.line} has no END:${last.name}.`);
  }
  if (!calendar) return failure(1, "The file doesn't start with BEGIN:VCALENDAR.");
  return { ok: true, calendar, problems };
}

function emit(node: CalendarNode, out: string[]): void {
  if (node.kind === 'invalid') {
    out.push(...node.raw);
    return;
  }
  if (node.kind === 'property') {
    out.push(...(node.raw ?? fold(formatContentLine(node))));
    return;
  }
  out.push(...(node.begin ?? fold(`BEGIN:${node.name}`)));
  for (const child of node.children) emit(child, out);
  out.push(...(node.end ?? fold(`END:${node.name}`)));
}

/** The file's text: CRLF line endings, ending with one. */
export function writeCalendar(calendar: ComponentNode): string {
  const lines: string[] = [];
  emit(calendar, lines);
  return `${lines.join('\r\n')}\r\n`;
}

// ——— Building and reading nodes ———

export function propertyNode(name: string, value: string, params: readonly Parameter[] = []): PropertyNode {
  return { kind: 'property', name: name.toUpperCase(), params, value, raw: null, line: 0 };
}

export function componentNode(name: string, children: readonly CalendarNode[] = []): ComponentNode {
  return { kind: 'component', name: name.toUpperCase(), children, begin: null, end: null, line: 0 };
}

export function properties(component: ComponentNode, name: string): PropertyNode[] {
  const upper = name.toUpperCase();
  return component.children.filter((c): c is PropertyNode => c.kind === 'property' && c.name === upper);
}

/** The first property called `name`, or undefined. */
export function property(component: ComponentNode, name: string): PropertyNode | undefined {
  return properties(component, name)[0];
}

export function components(component: ComponentNode, name: string): ComponentNode[] {
  const upper = name.toUpperCase();
  return component.children.filter((c): c is ComponentNode => c.kind === 'component' && c.name === upper);
}

/** The first value of the parameter called `name`, or undefined. */
export function paramValue(line: ContentLine, name: string): string | undefined {
  const upper = name.toUpperCase();
  return line.params.find((p) => p.name === upper)?.values[0];
}

/**
 * Where new properties go, so files Daybird writes read in a familiar order (PRD §3.3). Properties it
 * doesn't know go last; properties already in a file stay where they are.
 */
const PROPERTY_ORDER: readonly string[] = [
  'PRODID',
  'VERSION',
  'CALSCALE',
  'METHOD',
  'X-WR-CALNAME',
  'X-APPLE-CALENDAR-COLOR',
  'TZID',
  'UID',
  'DTSTAMP',
  'CREATED',
  'LAST-MODIFIED',
  'SEQUENCE',
  'RECURRENCE-ID',
  'SUMMARY',
  'LOCATION',
  'DESCRIPTION',
  'URL',
  'DTSTART',
  'DTEND',
  'DURATION',
  'RRULE',
  'RDATE',
  'EXRULE',
  'EXDATE',
  'STATUS',
  'TRANSP',
  'CATEGORIES',
  'ACTION',
  'TRIGGER',
];

function rank(name: string): number {
  const index = PROPERTY_ORDER.indexOf(name);
  return index < 0 ? Number.POSITIVE_INFINITY : index;
}

/**
 * Sets a property: replaces the first one with the same name where it stands (and drops any others with
 * that name), or inserts it after the last property that comes before it in the house order.
 */
export function withProperty(component: ComponentNode, prop: PropertyNode): ComponentNode {
  const existing = component.children.findIndex((c) => c.kind === 'property' && c.name === prop.name);
  if (existing >= 0) {
    const old = component.children[existing];
    if (old?.kind === 'property' && sameContent(old, prop)) return component;
    const children = component.children.filter(
      (c, i) => i === existing || !(c.kind === 'property' && c.name === prop.name),
    );
    return { ...component, children: children.map((c, i) => (i === existing ? prop : c)) };
  }
  return { ...component, children: insertProperty(component.children, prop) };
}

/** Adds a property next to others of its name (RDATE, EXDATE, ATTENDEE can repeat). */
export function withAddedProperty(component: ComponentNode, prop: PropertyNode): ComponentNode {
  return { ...component, children: insertProperty(component.children, prop) };
}

function insertProperty(children: readonly CalendarNode[], prop: PropertyNode): CalendarNode[] {
  const own = rank(prop.name);
  let at = -1;
  let firstProperty = -1;
  let lastProperty = -1;
  children.forEach((c, i) => {
    if (c.kind === 'component') return;
    if (firstProperty < 0) firstProperty = i;
    lastProperty = i;
    if (c.kind === 'property' && rank(c.name) <= own) at = i + 1;
  });
  if (at < 0) at = own === Number.POSITIVE_INFINITY ? lastProperty + 1 : Math.max(firstProperty, 0);
  return [...children.slice(0, at), prop, ...children.slice(at)];
}

function sameContent(a: ContentLine, b: ContentLine): boolean {
  return a.name === b.name && a.value === b.value && JSON.stringify(a.params) === JSON.stringify(b.params);
}

export function withoutProperty(component: ComponentNode, name: string): ComponentNode {
  const upper = name.toUpperCase();
  const children = component.children.filter((c) => !(c.kind === 'property' && c.name === upper));
  return children.length === component.children.length ? component : { ...component, children };
}

/** Replaces the children; the BEGIN and END lines are kept. */
export function withChildren(component: ComponentNode, children: readonly CalendarNode[]): ComponentNode {
  return { ...component, children };
}
