/** Calendar colours (PRD §5.6). */

export interface PaletteColour {
  readonly name: string;
  readonly hex: string;
}

/** The palette for new calendars, in the order new calendars take them. */
export const PALETTE: readonly PaletteColour[] = [
  { name: 'Blue', hex: '#1f77d0' },
  { name: 'Red', hex: '#e5484d' },
  { name: 'Orange', hex: '#f76808' },
  { name: 'Yellow', hex: '#e2a300' },
  { name: 'Green', hex: '#30a46c' },
  { name: 'Teal', hex: '#12a594' },
  { name: 'Purple', hex: '#8e4ec6' },
  { name: 'Pink', hex: '#d6409f' },
  { name: 'Brown', hex: '#a07553' },
  { name: 'Gray', hex: '#8b8d98' },
];

/** The accent colours Settings offers (§5.3). */
export const ACCENTS = ['blue', 'red', 'orange', 'green', 'teal', 'purple', 'pink'] as const;
export type Accent = (typeof ACCENTS)[number];

export function isAccent(value: unknown): value is Accent {
  return typeof value === 'string' && (ACCENTS as readonly string[]).includes(value);
}

const HEX = /^#([0-9a-f]{6})$/i;

/** The colour a new calendar takes: the first palette colour no calendar uses yet, else round the palette. */
export function nextCalendarColour(used: readonly string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()));
  const free = PALETTE.find((c) => !taken.has(c.hex));
  return (free ?? PALETTE[used.length % PALETTE.length] ?? PALETTE[0]!).hex;
}

/** Relative luminance (WCAG 2) of a `#rrggbb` colour, or null for anything else. */
export function luminance(hex: string): number | null {
  const m = HEX.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Fills lighter than this take black text. */
const LIGHT_FILL = 0.4;

/**
 * Text on a fill of `hex` (§5.4): white unless the fill is light. Strict WCAG contrast picks black on
 * mid-tone blues and greens, which reads worse at chip sizes, so the cut-off sits above the even point.
 */
export function textOn(hex: string): '#ffffff' | '#000000' {
  return (luminance(hex) ?? 0) > LIGHT_FILL ? '#000000' : '#ffffff';
}
