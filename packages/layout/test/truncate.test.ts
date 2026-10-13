// TXT2-f: text-overflow ellipsis in the engine (truncate.ts, a port of Blink's LineTruncator). Chrome agreement is proven by the
// text-overflow fixture group (packages/parity); these cases pin the port's decisions in 10px Ahem (every glyph and U+2026 1em).
import { describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutBox, LayoutRect, LayoutResult, LayoutStyle } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, fontDataMeasurer, fromCssPx, layoutWithFaults, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines } from '../src/index.ts';
import { AHEM_FONT_DATA } from '../src/text.ts';
import type { TextMeasurer } from '../src/text.ts';
import { ahemFont, box, neutralEnvironment, px, span, text } from './helpers.ts';

const G = 640;
const TRUNCATE: Partial<LayoutStyle> = { width: px(55), overflowX: 'hidden', overflowY: 'hidden', textOverflow: 'ellipsis' };
const nowrap = (id: string, value: string, size = 10) => text(id, value, { textWrapMode: 'nowrap', font: ahemFont(size) });

function run(root: LayoutBox, faults: EngineFaults = NO_ENGINE_FAULTS, measurer: TextMeasurer = ahemMeasurer): LayoutResult {
  return layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root }, measurer, faults);
}

/** [x, width] of each line fragment of a leaf, absolute, in LU. */
function frags(r: LayoutResult, leaf: string): number[][] {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  const abs = absoluteRects(r.boxes);
  const out: number[][] = [];
  for (let j = 0; abs.has(`${leaf}:line${j}`); j++) {
    const l = abs.get(`${leaf}:line${j}`) as LayoutRect;
    out.push([l.x, l.width]);
  }
  return out;
}

const ctx = (measurer: TextMeasurer = ahemMeasurer, faults: EngineFaults = NO_ENGINE_FAULTS) => ({ measurer, devicePixelRatio: 1, faults, gridFaults: NO_GRID_FAULTS });

describe('TXT2-f: line truncation (line_truncator.cc TruncateLine)', () => {
  it('cuts an overflowing nowrap line at a character, not a word, and puts U+2026 after it', () => {
    const b = box('a', TRUNCATE, [nowrap('t', 'XX XX XX XX')]);
    const [line] = placeLines(ctx(), b, fromCssPx(55));
    expect(line?.pieces).toEqual([{ leaf: 0, start: 0, visibleEnd: 11, end: 11, x: 0, width: 11 * G, top: 0, ascent: 512, descent: 128, paintEnd: 4, truncated: true, truncatedWidth: 4 * G }]);
    expect(line?.ellipsis).toEqual({ leaf: 0, text: '…', font: { family: 'Ahem', size: 10, letterSpacing: 0 }, x: 4 * G, width: G, top: 0, ascent: 512, descent: 128 });
  });

  it('keeps the full fragment before the truncated one, so the text and the block keep their sizes', () => {
    const r = run(box('root', {}, [box('a', TRUNCATE, [nowrap('t', 'XX XX XX XX')])]));
    expect(frags(r, 't')).toEqual([[0, 11 * G], [0, 4 * G]]);
    if (r.kind !== 'ok') throw new Error('unsupported');
    expect(absoluteRects(r.boxes).get('t')?.width).toBe(11 * G);
  });

  it('leaves a line that fits, or a block with overflow visible, alone', () => {
    const [fits] = placeLines(ctx(), box('a', TRUNCATE, [nowrap('t', 'XXXXX')]), fromCssPx(55));
    expect(fits?.ellipsis).toBeNull();
    expect(fits?.pieces[0]?.paintEnd).toBe(5);
    const [visible] = placeLines(ctx(), box('a', { ...TRUNCATE, overflowX: 'visible', overflowY: 'visible' }, [nowrap('t', 'XX XX XX XX')]), fromCssPx(55));
    expect(visible?.ellipsis).toBeNull();
    expect(visible?.pieces[0]?.truncated).toBe(false);
  });

  it('puts the ellipsis after a child that fits and hides the children after it', () => {
    const b = box('a', TRUNCATE, [nowrap('t0', 'XXXX'), span('s', [nowrap('t1', 'XXXX')])]);
    const [line] = placeLines(ctx(), b, fromCssPx(55));
    expect(line?.pieces.map((p) => [p.paintEnd, p.truncated])).toEqual([[4, false], [0, false]]);
    expect(line?.ellipsis?.x).toBe(4 * G);
    expect(line?.ellipsis?.leaf).toBe(0);
  });

  it('shapes the ellipsis in the line font, not the text font', () => {
    const b = box('a', TRUNCATE, [span('s', [nowrap('t', 'XXXXXXXXXXXX', 5)], { font: ahemFont(5) })], { font: ahemFont(10), lineHeight: { kind: 'normal' } });
    const [line] = placeLines(ctx(), b, fromCssPx(55));
    expect(line?.ellipsis?.width).toBe(G);
    expect(line?.pieces[0]?.paintEnd).toBe(9);
    const [planted] = placeLines(ctx(ahemMeasurer, { ...NO_ENGINE_FAULTS, ellipsisInTextFont: true }), b, fromCssPx(55));
    expect(planted?.ellipsis?.width).toBe(G / 2);
  });

  it('reports an inline box on a truncated line as Chrome reports a culled one: the whole run of its text, its truncated part, the ellipsis', () => {
    const r = run(box('root', {}, [box('a', TRUNCATE, [span('s', [nowrap('t', 'XXXXXXXXXXXXXXXXXXXX', 5)], { font: ahemFont(5) })], { font: ahemFont(10), lineHeight: { kind: 'normal' } })]));
    expect(frags(r, 's')).toEqual([[0, 10 * G], [0, 9 * G / 2], [9 * G / 2, G]]);
  });

  it('keeps the first character of a line even when the ellipsis does not fit after it', () => {
    const b = box('a', { ...TRUNCATE, width: px(15) }, [nowrap('t', 'XXXX')]);
    const [line] = placeLines(ctx(), b, fromCssPx(15));
    expect(line?.pieces[0]?.paintEnd).toBe(1);
    expect(line?.ellipsis?.x).toBe(G);
  });

  it('falls back to three dots in a font without U+2026 (planted fault noDotsFallback draws one)', () => {
    const noEllipsis = fontDataMeasurer({ ...AHEM_FONT_DATA, ellipsisAdvance: -1 }, { metricHalfUp: false, untruncatedFontSize: false });
    const b = box('a', TRUNCATE, [nowrap('t', 'XX XX XX XX')]);
    const [line] = placeLines(ctx(noEllipsis), b, fromCssPx(55));
    expect(line?.ellipsis).toMatchObject({ text: '...', width: 3 * G, x: 2 * G });
    const [planted] = placeLines(ctx(noEllipsis, { ...NO_ENGINE_FAULTS, noDotsFallback: true }), b, fromCssPx(55));
    expect(planted?.ellipsis?.text).toBe('.');
  });

  it('planted fault truncateChangesBlockSize drops the full fragment', () => {
    const r = run(box('root', {}, [box('a', TRUNCATE, [nowrap('t', 'XX XX XX XX')])]), { ...NO_ENGINE_FAULTS, truncateChangesBlockSize: true });
    expect(frags(r, 't')).toEqual([[0, 4 * G]]);
  });

  it('refuses rtl and an empty inline box on a truncated line', () => {
    const rtl = run(box('root', {}, [box('a', { ...TRUNCATE, direction: 'rtl' }, [nowrap('t', 'XX XX XX XX')])]));
    expect(rtl.kind === 'unsupported' && rtl.unsupported.code).toBe('text-overflow');
    const empty = run(box('root', {}, [box('a', TRUNCATE, [span('s', []), nowrap('t', 'XX XX XX XX')])]));
    expect(empty.kind === 'unsupported' && empty.unsupported.code).toBe('text-overflow');
  });

  it('refuses letter-spacing on a truncated line, and leaves a spaced line that fits alone', () => {
    const spaced = (value: string) => text('t', value, { textWrapMode: 'nowrap', font: ahemFont(10), letterSpacing: px(1) });
    const cut = run(box('root', {}, [box('a', TRUNCATE, [spaced('XX XX XX XX')])]));
    expect(cut.kind === 'unsupported' && cut.unsupported.code).toBe('text-overflow');
    expect(cut.kind === 'unsupported' && cut.unsupported.nodeId).toBe('t');
    const fits = run(box('root', {}, [box('a', TRUNCATE, [spaced('XXXX')])]));
    expect(fits.kind).toBe('ok');
  });

  it('refuses preserved white space on an overflowing truncated line (TXT2-c with TXT2-f), and leaves one that fits alone', () => {
    const pre = (value: string) => text('t', value, { textWrapMode: 'nowrap', whiteSpaceCollapse: 'preserve', font: ahemFont(10) });
    const cut = run(box('root', {}, [box('a', TRUNCATE, [pre('XX  XX XX')])]));
    expect(cut.kind === 'unsupported' && cut.unsupported.code).toBe('text-overflow');
    expect(run(box('root', {}, [box('a', TRUNCATE, [pre('XX  X')])])).kind).toBe('ok');
  });

  it('refuses letter-spacing on preserved text (TXT2-b with TXT2-c)', () => {
    const r = run(box('root', {}, [box('a', { width: px(200) }, [text('t', 'XX  XX', { whiteSpaceCollapse: 'preserve', letterSpacing: px(1) })])]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('letter-spacing');
  });
});
