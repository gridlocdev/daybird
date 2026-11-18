/**
 * iCalendar content lines (RFC 5545 §3.1, PRD §3.2–§3.3). A logical line is `NAME;PARAM=a,"b:c":VALUE`;
 * on disk it's folded into physical lines of at most 75 octets. Parameter values decode RFC 6868 caret
 * escapes; TEXT values use backslash escapes, handled by `unescapeText` and `escapeText`.
 */

export interface Parameter {
  /** Upper-cased. */
  readonly name: string;
  /** Unquoted and decoded. */
  readonly values: readonly string[];
}

export interface ContentLine {
  /** Upper-cased. */
  readonly name: string;
  readonly params: readonly Parameter[];
  /** The value as written, still escaped. */
  readonly value: string;
}

export type ParsedContentLine =
  { readonly ok: true; readonly line: ContentLine } | { readonly ok: false; readonly message: string };

/** The longest physical line, in UTF-8 octets, not counting the line ending. */
export const FOLD_OCTETS = 75;

const NAME = /^[A-Za-z0-9-]+$/;

function failure(message: string): ParsedContentLine {
  return { ok: false, message };
}

function decodeParam(text: string): string {
  return text.replace(/\^([\^nN'])/g, (_, c: string) => (c === '^' ? '^' : c === "'" ? '"' : '\n'));
}

/** Parses one unfolded line. Names are upper-cased; the value is kept exactly as written. */
export function parseContentLine(text: string): ParsedContentLine {
  const n = text.length;
  let i = 0;
  while (i < n && text[i] !== ';' && text[i] !== ':') i++;
  const name = text.slice(0, i);
  if (name === '') return failure('The line has no property name.');
  if (!NAME.test(name)) return failure(`"${name}" isn't a property name.`);
  const params: Parameter[] = [];
  while (text[i] === ';') {
    i++;
    const start = i;
    while (i < n && text[i] !== '=' && text[i] !== ';' && text[i] !== ':') i++;
    const paramName = text.slice(start, i);
    if (!NAME.test(paramName)) return failure(`"${paramName}" isn't a parameter name.`);
    if (text[i] !== '=') return failure(`The parameter ${paramName} has no value.`);
    i++;
    const values: string[] = [];
    for (;;) {
      if (text[i] === '"') {
        const close = text.indexOf('"', i + 1);
        if (close < 0) return failure(`The parameter ${paramName} opens a quote that never closes.`);
        values.push(decodeParam(text.slice(i + 1, close)));
        i = close + 1;
        if (i < n && text[i] !== ',' && text[i] !== ';' && text[i] !== ':') {
          return failure(`The parameter ${paramName} has text after its closing quote.`);
        }
      } else {
        const valueStart = i;
        while (i < n && text[i] !== ',' && text[i] !== ';' && text[i] !== ':' && text[i] !== '"') i++;
        if (text[i] === '"') return failure(`The parameter ${paramName} has a quote inside its value.`);
        values.push(decodeParam(text.slice(valueStart, i)));
      }
      if (text[i] !== ',') break;
      i++;
    }
    params.push({ name: paramName.toUpperCase(), values });
  }
  if (text[i] !== ':') return failure('The line has no ":" before its value.');
  return { ok: true, line: { name: name.toUpperCase(), params, value: text.slice(i + 1) } };
}

function formatParamValue(value: string): string {
  const encoded = value
    .replace(/\^/g, '^^')
    .replace(/\r\n|\r|\n/g, '^n')
    .replace(/"/g, "^'");
  return /[;:,]/.test(encoded) ? `"${encoded}"` : encoded;
}

/** The unfolded text of a line; values that hold `;`, `:` or `,` are quoted. */
export function formatContentLine(line: ContentLine): string {
  let out = line.name;
  for (const p of line.params) out += `;${p.name}=${p.values.map(formatParamValue).join(',')}`;
  return `${out}:${line.value}`;
}

/** Octets `char` takes in UTF-8 (a lone surrogate is written as U+FFFD, 3 octets). */
function utf8Octets(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  return code < 0x10000 ? 3 : 4;
}

/** Octets `text` takes in UTF-8. */
export function utf8Length(text: string): number {
  let total = 0;
  for (const char of text) total += utf8Octets(char);
  return total;
}

/**
 * Splits a logical line into physical lines of at most 75 octets, never inside a UTF-8 character. Each
 * line after the first starts with one space, which counts towards its 75.
 */
export function fold(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const octets = utf8Octets(char);
    if (size + octets > FOLD_OCTETS) {
      out.push(current);
      current = ' ';
      size = 1;
    }
    current += char;
    size += octets;
  }
  out.push(current);
  return out;
}

/** A TEXT value as plain text: `\n` is a line break; `\,` `\;` `\\` (and the common, non-standard `\:`) lose their backslash. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,:nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Plain text as a TEXT value. */
export function escapeText(text: string): string {
  return text.replace(/[\\;,]/g, '\\$&').replace(/\r\n|\r|\n/g, '\\n');
}

/** Splits a multi-value TEXT property (CATEGORIES, RESOURCES) on unescaped commas and unescapes each part. */
export function splitTextList(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\') i++;
    else if (value[i] === ',') {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map(unescapeText);
}
