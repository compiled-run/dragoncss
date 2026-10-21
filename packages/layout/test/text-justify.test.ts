// TXT2-tj: text-justify (css-text-3 §7.4) on justified lines, as Blink 145 picks each character's justification opportunities
// (justification_opportunity.cc CheckJustificationOpportunity, shape_result_spacing.cc ExpansionSetup) in 10px Ahem. Chrome agreement
// is proven by fixture group text-justify (packages/parity, text-justify-values-ahem).
import { describe, expect, it } from 'vitest';
import type { EngineFaults, TextJustify, TextLeaf } from '../src/index.ts';
import { ahemMeasurer, fromCssPx, inlineLeaves, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines } from '../src/index.ts';
import { UnsupportedSignal } from '../src/unsupported.ts';
import { box, px, span, text } from './helpers.ts';

/** The children of a test block. */
type Kids = NonNullable<Parameters<typeof box>[2]>;
const ctx = (faults: EngineFaults = NO_ENGINE_FAULTS) => ({ measurer: ahemMeasurer, devicePixelRatio: 1, faults, gridFaults: NO_GRID_FAULTS });
const leaf = (id: string, value: string, textJustify: TextJustify): TextLeaf => text(id, value, { textJustify });

/** Each line's per-code-point shifts of its first piece, in a justified block width px wide. */
function shifts(width: number, kids: Kids, faults: EngineFaults = NO_ENGINE_FAULTS): number[][] {
  const b = box('a', { width: px(width), textAlign: 'justify' }, kids);
  return placeLines(ctx(faults), b, fromCssPx(width)).map((l) => l.pieces.flatMap((p) => [...p.shifts]));
}

/** Each line's css px left of every non-space character: the piece's x, the advances before it and its shift. */
function lefts(width: number, kids: Kids): number[][] {
  const b = box('a', { width: px(width), textAlign: 'justify' }, kids);
  const leaves = inlineLeaves(b);
  return placeLines(ctx(), b, fromCssPx(width)).map((l) => {
    const xs: number[] = [];
    for (const p of l.pieces) {
      const t = leaves[p.leaf] as TextLeaf;
      for (let i = p.start; i < p.visibleEnd; i++) if (t.text[i] !== ' ') xs.push(p.x / 64 + (i - p.start) * 10 + (p.shifts[i - p.start] ?? 0));
    }
    return xs;
  });
}

describe('TXT2-tj: text-justify', () => {
  it('expands at spaces under auto and inter-word, and nowhere under none', () => {
    // "XX XX" in 55px: 5px free on one space.
    for (const m of ['auto', 'inter-word'] as const) expect(shifts(55, [leaf('t', 'XX XX XXX X', m)]), m).toEqual([[0, 0, 0, 5, 5], []]);
    expect(shifts(55, [leaf('t', 'XX XX XXX X', 'none')])).toEqual([[], []]);
  });

  it('expands after every character but the line\'s last under inter-character, the remainder on the last', () => {
    // 5px over 4 opportunities: 1.25px each.
    expect(shifts(55, [leaf('t', 'XX XX XXX X', 'inter-character')])).toEqual([[0, 1.25, 2.5, 3.75, 5], []]);
    // 7.296875px over 5: 1.459375 truncated to 16.16 four times, the rest on the fifth.
    const each = Math.trunc((7.296875 * 65536) / 5) / 65536;
    const [first] = shifts(67.3, [leaf('t', 'XXX XX X XXXX XX', 'inter-character')]);
    expect(first).toEqual([0, each, 2 * each, 3 * each, 4 * each, 7.296875]);
  });

  it('carries the opportunity context across texts of different text-justify', () => {
    // "XX X X" in 73px: 13px free, all on the one auto space; the none spaces and the hanging one take nothing.
    expect(lefts(73, [leaf('t', 'XX ', 'auto'), span('s', [leaf('u', 'X X ', 'none')]), leaf('v', 'XXXX XX X', 'auto')])[0]).toEqual([0, 10, 43, 63]);
    // "XX XX" in 73px, "XX X" inter-character then the span's auto "X": 23px over the 4 inter-character characters, 5.75px each;
    // the auto X ending the line has no opportunity after it, so none is dropped at the line end.
    expect(lefts(73, [leaf('t', 'XX X', 'inter-character'), span('s', [leaf('u', 'X XX ', 'auto')]), leaf('v', 'XXX X XX', 'inter-character')])[0]).toEqual([0, 15.75, 47.25, 63]);
  });

  it('refuses what no Chrome case covers', () => {
    const code = (kids: Kids): string | null => {
      try {
        shifts(55, kids);
        return null;
      } catch (e) {
        if (e instanceof UnsupportedSignal) return e.unsupported.detail;
        throw e;
      }
    };
    // "XXX" on the first line: the auto X, with no opportunity after it, directly before an inter-character X.
    expect(code([leaf('t', 'XX', 'auto'), span('s', [leaf('u', 'X XX XXX X', 'inter-character')])])).toContain('after a character of another text-justify');
    expect(code([leaf('t', 'XX X­X XXX', 'inter-character')])).toContain('U+AD');
  });

  it('refuses an rtl line mixing inter-character with another text-justify, and lays out an rtl line of one', () => {
    const rtl = (kids: Kids): string | null => {
      const b = box('a', { width: px(73), textAlign: 'justify', direction: 'rtl' }, kids);
      try {
        placeLines(ctx(), b, fromCssPx(73));
        return null;
      } catch (e) {
        if (e instanceof UnsupportedSignal) return e.unsupported.detail;
        throw e;
      }
    };
    expect(rtl([leaf('t', 'XX X', 'inter-character'), span('s', [leaf('u', 'X XX ', 'auto')]), leaf('v', 'XXX X XX', 'inter-character')])).toBe('text-justify: inter-character on t on an rtl line with u of another text-justify is not proven against Chrome');
    expect(rtl([leaf('t', 'XX XX XXX X', 'inter-character')])).toBeNull();
    expect(rtl([leaf('t', 'XX ', 'auto'), span('s', [leaf('u', 'X X ', 'none')]), leaf('v', 'XXXX XX X', 'auto')])).toBeNull();
  });

  it('planted fault textJustifyAuto justifies every text as auto', () => {
    const faults = { ...NO_ENGINE_FAULTS, textJustifyAuto: true };
    expect(shifts(55, [leaf('t', 'XX XX XXX X', 'inter-character')], faults)).toEqual([[0, 0, 0, 5, 5], []]);
    expect(shifts(55, [leaf('t', 'XX XX XXX X', 'none')], faults)).toEqual([[0, 0, 0, 5, 5], []]);
  });
});
