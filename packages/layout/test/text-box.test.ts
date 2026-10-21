// css-inline-3 §5.1 text-box-trim in the engine (inline.ts trimLineStart and trimmedLineEnd), a port of Blink's
// InlineLayoutAlgorithm::ApplyTextBoxTrim with InlineBoxState::AdjustEdges for the text and alphabetic edges. Chrome agreement is
// proven by the text-box fixture group (packages/parity); these cases pin the port's arithmetic in 10px Ahem (ascent 8, descent 2).
import { describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutBox, LayoutResult, LayoutStyle, LineHeightValue, TextBoxTrim } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, fromCssPx, layoutWithFaults, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines, validateLayoutInput } from '../src/index.ts';
import { ahemFont, box, br, neutralEnvironment, px, span, text } from './helpers.ts';

const LH2: LineHeightValue = { kind: 'number', value: 2 };
const BOTH: TextBoxTrim = { start: true, end: true, alphabetic: false };
const t = (id: string, value: string, lineHeight: LineHeightValue = LH2, size = 10) => text(id, value, { font: ahemFont(size), lineHeight });
const ctx = (faults: EngineFaults = NO_ENGINE_FAULTS) => ({ measurer: ahemMeasurer, devicePixelRatio: 1, faults, gridFaults: NO_GRID_FAULTS });
const trimmed = (id: string, trim: TextBoxTrim, kids: Parameters<typeof box>[2], style: Partial<LayoutStyle> = {}): LayoutBox => box(id, { width: px(55), textBoxTrim: trim, ...style }, kids);

function run(root: LayoutBox, faults: EngineFaults = NO_ENGINE_FAULTS): LayoutResult {
  return layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer, faults);
}

function rect(r: LayoutResult, id: string): { readonly y: number; readonly height: number } {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  const q = absoluteRects(r.boxes).get(id);
  if (q === undefined) throw new Error(`no rect ${id}`);
  return { y: q.y / 64, height: q.height / 64 };
}

// Five 20px lines of "XX XXX XX XXXX X" at 55px; each line's baseline is 13px below its top (half-leading 5).
const FIVE = 'XX XXX XX XXXX X';

describe('text-box-trim: one inline formatting context', () => {
  it('trim-start moves every line up by the line ascent above the font ascent, and trim-end cuts the last line below the descent', () => {
    const lines = placeLines(ctx(), trimmed('a', BOTH, [t('t', FIVE)]), fromCssPx(55));
    expect(lines.map((l) => [l.top / 64, l.baseline / 64])).toEqual([[-5, 8], [15, 28], [35, 48], [55, 68], [75, 88]]);
    expect(lines[0]?.pieces[0]?.top).toBe(0);
    expect(rect(run(box('root', {}, [trimmed('a', BOTH, [t('t', FIVE)])])), 'a').height).toBe(90);
    expect(rect(run(box('root', {}, [trimmed('a', { start: true, end: false, alphabetic: false }, [t('t', FIVE)])])), 'a').height).toBe(95);
    expect(rect(run(box('root', {}, [trimmed('a', { start: false, end: true, alphabetic: false }, [t('t', FIVE)])])), 'a').height).toBe(95);
  });

  it('an alphabetic under edge ends the content at the last baseline', () => {
    expect(rect(run(box('root', {}, [trimmed('a', { ...BOTH, alphabetic: true }, [t('t', FIVE)])])), 'a').height).toBe(88);
    expect(rect(run(box('root', {}, [trimmed('a', { start: false, end: true, alphabetic: true }, [t('t', 'XX')])])), 'a').height).toBe(13);
  });

  it('a line height below the glyphs grows the box to the glyphs (negative leading)', () => {
    // line-height 0.5: 5px lines with the baseline 5px down (half-leading floored to -3); one line becomes ascent + descent.
    expect(rect(run(box('root', {}, [trimmed('a', BOTH, [t('t', 'XX', { kind: 'number', value: 0.5 })])])), 'a').height).toBe(10);
  });

  it('the line box is the line\'s own, with a taller inline box, while the edges are the strut font\'s', () => {
    const big = span('s', [t('st', 'XX', { kind: 'number', value: 1 }, 20)], { font: ahemFont(20), lineHeight: { kind: 'number', value: 1 } });
    const lines = placeLines(ctx(), trimmed('a', BOTH, [t('t', 'X '), big], { width: px(100) }), fromCssPx(100));
    // The 20px span puts the baseline 16px down: trim-start moves the line up by 16 - 8.
    expect(lines.map((l) => [l.top / 64, l.baseline / 64, l.height / 64])).toEqual([[-8, 8, 23]]);
    expect(rect(run(box('root', {}, [trimmed('a', BOTH, [t('t', 'X '), big], { width: px(100) })])), 'a').height).toBe(10);
  });

  it('keeps the box\'s own padding and border, and a following block starts after the trimmed end', () => {
    const r = run(box('root', {}, [trimmed('a', BOTH, [t('t', FIVE)], { paddingTop: px(4), paddingBottom: px(3) }), box('b', { height: px(5) })]));
    expect(rect(r, 'a').height).toBe(97);
    expect(rect(r, 'b').y).toBe(97);
  });

  it('trims across a <br>, and an empty block has nothing to trim', () => {
    expect(rect(run(box('root', {}, [trimmed('a', BOTH, [t('t', 'XX'), br('b', { lineHeight: LH2 }), t('u', 'XX')])])), 'a').height).toBe(30);
    expect(rect(run(box('root', {}, [box('a', { textBoxTrim: BOTH, width: px(55) }, [], { font: ahemFont(10), lineHeight: LH2 })])), 'a').height).toBe(0);
  });

  it('catches the planted fault textBoxTrimIgnored', () => {
    expect(rect(run(box('root', {}, [trimmed('a', BOTH, [t('t', FIVE)])]), { ...NO_ENGINE_FAULTS, textBoxTrimIgnored: true }), 'a').height).toBe(100);
  });
});

describe('text-box-trim: refusals and validation', () => {
  it('refuses a trimmed block of block-level boxes, of preserved white space and with a line clamp', () => {
    const nested = run(box('root', {}, [box('a', { textBoxTrim: BOTH }, [box('b', {}, [t('t', 'XX')])])]));
    expect(nested.kind === 'unsupported' ? nested.unsupported.code : null).toBe('text-box-trim');
    const pre = run(box('root', {}, [trimmed('a', BOTH, [text('t', 'XX', { lineHeight: LH2, whiteSpaceCollapse: 'preserve' })])]));
    expect(pre.kind === 'unsupported' ? pre.unsupported.code : null).toBe('text-box-trim');
    const clamp = run(box('root', {}, [trimmed('a', BOTH, [t('t', FIVE)], { lineClamp: 2, overflowX: 'hidden', overflowY: 'hidden' })]));
    expect(clamp.kind === 'unsupported' ? clamp.unsupported.code : null).toBe('text-box-trim');
  });

  it('accepts a trim on a block, and rejects one that trims nothing or sits on an inline box', () => {
    const input = (root: LayoutBox) => JSON.parse(JSON.stringify({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root })) as unknown;
    expect(validateLayoutInput(input(box('root', {}, [trimmed('a', BOTH, [t('t', 'XX')])]))).ok).toBe(true);
    const none = validateLayoutInput(input(box('root', {}, [trimmed('a', { start: false, end: false, alphabetic: false }, [t('t', 'XX')])])));
    expect(none.ok ? [] : none.errors.map((e) => e.path)).toEqual(['$.root.children[0].style.textBoxTrim']);
    const inline = span('s', [text('st', 'XX')], { style: { ...box('x', {}).style, display: 'inline', textBoxTrim: BOTH } });
    const onInline = validateLayoutInput(input(box('root', {}, [box('a', {}, [inline])])));
    expect(onInline.ok ? [] : onInline.errors.map((e) => e.path)).toEqual(['$.root.children[0].children[0].style.textBoxTrim']);
  });
});
