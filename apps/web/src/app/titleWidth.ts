/**
 * How wide the toolbar's range title can get (PRD §5.1): the widest of the titles given, in the title's own
 * font (`--db-title-size` and `--db-font`), so the space for it can stay the same as the title changes and the controls after it stay put.
 */
import type { RangeTitle } from '@daybird/core';

/** The title's main part is bold and its year light, as `.db-range-title` draws them. */
const MAIN_WEIGHT = 700;
const YEAR_WEIGHT = 300;

export function widestTitle(titles: readonly RangeTitle[]): number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 0;
  const root = getComputedStyle(document.documentElement);
  const fontSize = root.getPropertyValue('--db-title-size').trim();
  const fontFamily = root.getPropertyValue('--db-font').trim();
  if (!fontSize || !fontFamily) return 0;
  const width = (text: string, weight: number) => {
    ctx.font = `${weight} ${fontSize} ${fontFamily}`;
    return ctx.measureText(text).width;
  };
  const space = width(' ', 400);
  let widest = 0;
  for (const t of titles) {
    widest = Math.max(widest, (t.main ? width(t.main, MAIN_WEIGHT) + space : 0) + width(t.year, YEAR_WEIGHT));
  }
  return Math.ceil(widest);
}
