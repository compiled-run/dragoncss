// TXT-TW: text-wrap-style balance and pretty in the engine (inline.ts wrapStyleLines, text-wrap.ts), a port of Blink 145's
// ScoreLineBreaker and ParagraphLineBreaker. Chrome agreement is proven by fixture group text-wrap (packages/parity,
// text-wrap-balance-ahem); these cases pin the port's decisions in 10px Ahem, where each expected break is the one Blink's score
// (the sum of each line's squared slack, a line penalty per line and the orphans penalty) or its bisection picks.
import { describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutBox, LayoutStyle, TextWrapStyle } from '../src/index.ts';
import { ahemMeasurer, fromCssPx, layoutWithFaults, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines, validateLayoutInput, zoomInput } from '../src/index.ts';
import { linePenaltyOf, scoreBreakPoints } from '../src/text-wrap.ts';
import { ahemFont, box, neutralEnvironment, px, span, text } from './helpers.ts';
import { UnsupportedSignal } from '../src/unsupported.ts';

const ctx = (faults: EngineFaults = NO_ENGINE_FAULTS) => ({ measurer: ahemMeasurer, devicePixelRatio: 1, faults, gridFaults: NO_GRID_FAULTS });
const BALANCE: TextWrapStyle = { kind: 'balance', zoom: 1 };
const PRETTY: TextWrapStyle = { kind: 'pretty', zoom: 1 };

/** The text of each line of value in a block width px wide, with the given style. */
function lines(value: string, width: number, wrap: TextWrapStyle, style: Partial<LayoutStyle> = {}, faults: EngineFaults = NO_ENGINE_FAULTS, size = 10): string[] {
  const b = box('a', { width: px(width), textWrapStyle: wrap, ...style }, [text('t', value, { font: ahemFont(size) })]);
  return placeLines(ctx(faults), b, fromCssPx(width)).map((l) => {
    const p = l.pieces[0];
    return p === undefined ? '' : value.slice(p.start, p.visibleEnd);
  });
}

const greedy = (value: string, width: number): string[] => lines(value, width, { kind: 'auto' });

describe('TXT-TW: text-wrap-style: balance', () => {
  it('scores the paragraph when it ends within six lines and has three break opportunities or more', () => {
    expect(greedy('XX XXX XX XXXX XX X XXX', 100)).toEqual(['XX XXX XX', 'XXXX XX X', 'XXX']);
    expect(lines('XX XXX XX XXXX XX X XXX', 100, BALANCE)).toEqual(['XX XXX', 'XX XXXX', 'XX X XXX']);
    expect(lines('XXXXXX XX XXX XXXX X XXXXX XX XXX', 100, BALANCE)).toEqual(['XXXXXX XX', 'XXX XXXX', 'X XXXXX', 'XX XXX']);
    // Two lines score best as the greedy ones: a third line costs more than the slack it saves.
    expect(lines('XX XXX XX XXXX XX X XXX', 130, BALANCE)).toEqual(greedy('XX XXX XX XXXX XX X XXX', 130));
    expect(lines('XXX XX XXXX X XX XXXXX XXX XX', 87, BALANCE, {}, NO_ENGINE_FAULTS, 13)).toEqual(['XXX XX', 'XXXX', 'X XX', 'XXXXX', 'XXX XX']);
  });

  it('bisects the available width when the paragraph has too few break opportunities to score', () => {
    // Two lines of 90px and 20px: the narrowest width that keeps two lines is 70px ("XXXX XX").
    expect(greedy('XXXX XXXX XX', 100)).toEqual(['XXXX XXXX', 'XX']);
    expect(lines('XXXX XXXX XX', 100, BALANCE)).toEqual(['XXXX', 'XXXX XX']);
  });

  it('keeps the greedy lines for one line, more than six, or a word wider than the line', () => {
    expect(lines('XX XXX XX', 100, BALANCE)).toEqual(['XX XXX XX']);
    const long = Array.from({ length: 22 }, () => 'XX').join(' ');
    expect(lines(long, 100, BALANCE)).toEqual(greedy(long, 100));
    expect(lines(long, 100, BALANCE)).toHaveLength(8);
    expect(lines('XXXXXXXXXXXXXX XX XX XX', 100, BALANCE)).toEqual(['XXXXXXXXXXXXXX', 'XX XX XX']);
  });

  it('aligns the balanced lines in the whole available width', () => {
    const b = box('a', { width: px(100), textWrapStyle: BALANCE, textAlign: 'center' }, [text('t', 'XX XXX XX XXXX XX X XXX')]);
    expect(placeLines(ctx(), b, fromCssPx(100)).map((l) => (l.pieces[0]?.x ?? 0) / 64)).toEqual([20, 15, 10]);
  });
});

describe('TXT-TW: text-wrap-style: pretty', () => {
  it('scores the last lines when the last one is a single word shorter than a third of the line', () => {
    expect(greedy('XXXXX XXX XXXXXX XXX X', 100)).toEqual(['XXXXX XXX', 'XXXXXX XXX', 'X']);
    expect(lines('XXXXX XXX XXXXXX XXX X', 100, PRETTY)).toEqual(['XXXXX XXX', 'XXXXXX', 'XXX X']);
  });

  it('scores only the last four lines of a longer paragraph', () => {
    const value = 'XXXX XXXX XXXXX X XXXX XXX XX XXXXX X XXX';
    expect(greedy(value, 100)).toEqual(['XXXX XXXX', 'XXXXX X', 'XXXX XXX', 'XX XXXXX X', 'XXX']);
    expect(lines(value, 100, PRETTY)).toEqual(['XXXX XXXX', 'XXXXX X', 'XXXX XXX', 'XX XXXXX', 'X XXX']);
  });

  it('keeps the greedy lines when the last line is long or breakable, or the paragraph has too few break opportunities', () => {
    for (const value of ['XX XXXX XXX XXXXX XXXX X', 'XXXX XXXX XX', 'XXXXX XXXX XXXXX XXXX XX X']) expect(lines(value, 100, PRETTY), value).toEqual(greedy(value, 100));
  });
});

describe('TXT-TW: the score pass (ScoreLineBreaker::ComputeScores)', () => {
  const at = (positions: readonly (readonly [number, number])[]) => positions.map(([posNoBreak, posIfBreak], offset) => ({ offset, posNoBreak, posIfBreak, penalty: 0 }));
  // Words of 20px with 10px spaces: candidates after each word.
  const words = at([[0, 0], [30, 20], [60, 50], [90, 80], [120, 110], [140, 140]]);

  it('needs three break opportunities besides the two sentinels', () => {
    expect(scoreBreakPoints(words.slice(0, 4), 100 + 1 / 64, 4000, 1, true)).toBeNull();
    expect(scoreBreakPoints(words, 100 + 1 / 64, linePenaltyOf(100, 10, 1), 1, true)).toEqual([3, 5]);
  });

  it('picks the later line start on a tie', () => {
    // At exactly 100px, three words then two (slack 20 and 50) score as two then three (50 and 20): the later start wins.
    expect(scoreBreakPoints(words, 100, 4000, 1, true)).toEqual([3, 5]);
  });

  it('adds the orphans penalty at the last break opportunity', () => {
    // At 110px four words fill the first line exactly, but the last word alone would start at the orphan break: three then two win.
    expect(scoreBreakPoints(words, 110, 0, 1, false)).toEqual([3, 5]);
    expect(scoreBreakPoints(words, 110, 0, 1, true)).toEqual([3, 5]);
  });

  it('computes the line penalty as Minikin does: four times the width times the font size, unzoomed once', () => {
    expect(linePenaltyOf(100, 10, 1)).toBe(4000);
    expect(linePenaltyOf(262.5, 26.25, 2.625)).toBe(Math.fround(Math.fround(Math.fround(262.5 * 26.25) / 2.625) * 4));
  });
});

describe('TXT-TW: zoom, refusals and the plant', () => {
  const root = (b: LayoutBox): LayoutBox => box('root', {}, [b]);

  it('takes the zoom of the device pixel ratio in the environment pass, and validates it', () => {
    const b = box('a', { width: px(100), textWrapStyle: BALANCE }, [text('t', 'XX XXX XX XXXX XX X XXX')]);
    const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: 2.625, ...neutralEnvironment({ width: 400, height: 300 }), root: root(b) };
    const zoomed = zoomInput(input, NO_ENGINE_FAULTS).root.children[0] as LayoutBox;
    expect(zoomed.style.textWrapStyle).toEqual({ kind: 'balance', zoom: 2.625 });
    expect(validateLayoutInput(JSON.parse(JSON.stringify(input))).ok).toBe(true);
    const bad = JSON.parse(JSON.stringify(input)) as { root: { children: { style: Record<string, unknown> }[] } };
    (bad.root.children[0] as { style: Record<string, unknown> }).style['textWrapStyle'] = { kind: 'balance' };
    expect(validateLayoutInput(bad).ok).toBe(false);
  });

  it('balances at every lane zoom as at zoom 1 for these lines', () => {
    for (const z of [2, 2.625, 3]) {
      expect(lines('XX XXX XX XXXX XX X XXX', 100 * z, { kind: 'balance', zoom: z }, {}, NO_ENGINE_FAULTS, 10 * z), `${z}`).toEqual(['XX XXX', 'XX XXXX', 'XX X XXX']);
      expect(lines('XXXX XXXX XXXXX X XXXX XXX XX XXXXX X XXX', 100 * z, { kind: 'pretty', zoom: z }, {}, NO_ENGINE_FAULTS, 10 * z), `${z}`).toEqual(['XXXX XXXX', 'XXXXX X', 'XXXX XXX', 'XX XXXXX', 'X XXX']);
    }
  });

  it('refuses the contexts no Chrome case proves with text-wrap-style', () => {
    const code = (b: LayoutBox): string | null => {
      try {
        placeLines(ctx(), b, fromCssPx(100));
        return null;
      } catch (e) {
        if (e instanceof UnsupportedSignal) return e.unsupported.code;
        throw e;
      }
    };
    const t = () => text('t', 'XX XXX XX XXXX XX X XXX');
    expect(code(box('a', { width: px(100), textWrapStyle: BALANCE }, [t(), span('s', [text('u', ' XX')])]))).toBe('text-wrap-style');
    expect(code(box('a', { width: px(100), textWrapStyle: PRETTY, textAlign: 'justify' }, [t()]))).toBe('text-wrap-style');
    expect(code(box('a', { width: px(100), textWrapStyle: BALANCE, textIndent: px(5) }, [t()]))).toBe('text-wrap-style');
    expect(code(box('a', { width: px(100), textWrapStyle: BALANCE }, [text('t', 'XX XX', { letterSpacing: { kind: 'px', value: 1 } })]))).toBe('text-wrap-style');
    expect(code(box('a', { width: px(100), textWrapStyle: BALANCE }, [text('t', 'XX XX', { overflowWrap: 'anywhere' })]))).toBe('text-wrap-style');
    expect(code(box('a', { width: px(100), textWrapStyle: BALANCE }, [t()]))).toBeNull();
  });

  it('planted fault wrapStyleGreedy keeps the greedy lines', () => {
    const faults = { ...NO_ENGINE_FAULTS, wrapStyleGreedy: true };
    expect(lines('XX XXX XX XXXX XX X XXX', 100, BALANCE, {}, faults)).toEqual(greedy('XX XXX XX XXXX XX X XXX', 100));
    expect(lines('XXXXX XXX XXXXXX XXX X', 100, PRETTY, {}, faults)).toEqual(greedy('XXXXX XXX XXXXXX XXX X', 100));
    const b = box('a', { width: px(100), textWrapStyle: BALANCE }, [text('t', 'XX XXX XX XXXX XX X XXX')]);
    const r = layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root: root(b) }, ahemMeasurer, faults);
    expect(r.kind).toBe('ok');
  });
});
