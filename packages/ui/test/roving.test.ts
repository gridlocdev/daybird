import { describe, expect, it } from 'vitest';
import { radioKeys, rovingStep } from '../src/index.ts';

describe('roving focus', () => {
  it('steps through a row of choices with the arrows, wrapping, and jumps with Home and End', () => {
    expect(rovingStep('ArrowRight', 0, 3)).toBe(1);
    expect(rovingStep('ArrowDown', 2, 3)).toBe(0);
    expect(rovingStep('ArrowLeft', 0, 3)).toBe(2);
    expect(rovingStep('ArrowUp', 1, 3)).toBe(0);
    expect(rovingStep('Home', 2, 3)).toBe(0);
    expect(rovingStep('End', 0, 3)).toBe(2);
    expect(rovingStep('a', 0, 3)).toBeNull();
    expect(rovingStep('ArrowRight', 0, 0)).toBeNull();
  });

  it('picks the next choice in a radio group from the state, and takes the key from the page', () => {
    const scope = { closest: () => scope };
    const key = (k: string, mods: Partial<KeyboardEvent> = {}) => {
      const e = { key: k, currentTarget: scope, prevented: false, stopped: false, ...mods };
      return Object.assign(e, {
        preventDefault: () => (e.prevented = true),
        stopPropagation: () => (e.stopped = true),
      });
    };
    const picked: string[] = [];
    const right = key('ArrowRight');
    expect(radioKeys(right as unknown as KeyboardEvent, ['a', 'b', 'c'], 'c', (x) => picked.push(x))).toBe(
      true,
    );
    expect(picked).toEqual(['a']);
    expect(right.prevented && right.stopped).toBe(true);
    // A chord is a command, not a move in the group.
    const chord = key('ArrowRight', { metaKey: true });
    expect(radioKeys(chord as unknown as KeyboardEvent, ['a', 'b'], 'a', (x) => picked.push(x))).toBe(false);
    expect(chord.prevented).toBe(false);
    expect(picked).toEqual(['a']);
  });
});
