// The five engine rules of P2b (notes/T010-p2-triage.md), each reproducing its Chrome 145.0.7632.6 probe values through the engine.
// Output LU are 1/64 device px at every DPR (the zoom model, vectors/README.md "Device pixel ratios").
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layout, layoutWithFaults, NO_ENGINE_FAULTS } from '../src/index.ts';
import type { BorderWidthValue, LayoutBox, LayoutRect, LayoutResult, LayoutStyle, LineHeightValue } from '../src/index.ts';
import { cachedRangeWidth, fromCssPx, lineHeightFromNumber, percentOf, textAdvanceAt, zoomViewportPx } from '../src/units.ts';
import { box, text, neutralEnvironment, ahemFont } from './helpers.ts';

function run(root: LayoutBox, dpr: number, viewport = { width: 400, height: 300 }): Map<string, LayoutRect> {
  const r: LayoutResult = layout({ viewport, devicePixelRatio: dpr, ...neutralEnvironment(viewport), root }, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(r.unsupported.code);
  return absoluteRects(r.boxes);
}

const rect = (m: Map<string, LayoutRect>, id: string): LayoutRect => {
  const r = m.get(id);
  if (r === undefined) throw new Error(`no ${id}`);
  return r;
};

describe('R1: the initial containing block is ceil(viewport x DPR) device px', () => {
  it('Chrome 145 at 2.625: 300 -> 788, 301 -> 791, 299 -> 785, 302 -> 793, 401 -> 1053 device px (790.125 rounds up)', () => {
    const got = [300, 301, 299, 302, 401].map((w) => rect(run(box('html', {}), 2.625, { width: w, height: 300 }), 'html').width / 64);
    expect(got).toEqual([788, 791, 785, 793, 1053]);
    expect(zoomViewportPx(301, 2.625)).toBe(791);
  });
});

describe('R2 and R3: line heights round (LayoutUnit::FromFloatRound), at every DPR', () => {
  /** The line pitch in LU: the offset between the first two line fragments of a two-line paragraph. */
  function pitch(size: number, lh: LineHeightValue, dpr = 1): number {
    const m = run(box('html', {}, [box('p', { width: { kind: 'px', value: 1 } }, [text('p:text0', 'X X', { font: ahemFont(size), lineHeight: lh })])]), dpr);
    return rect(m, 'p:text0:line1').y - rect(m, 'p:text0:line0').y;
  }
  const num = (value: number): LineHeightValue => ({ kind: 'number', value });
  const px = (value: number): LineHeightValue => ({ kind: 'px', value });

  it('probe at DPR 1 (LU per line, Chrome): 13.7px/1 877, 13.7px/1.5 1315, 9.9px/2 1268, 9.6171875px 616, 12.0078125px 769, 10.4921875px 672', () => {
    expect([pitch(13.7, num(1)), pitch(13.7, num(1.5)), pitch(9.9, num(2)), pitch(10, px(9.6171875)), pitch(10, px(12.0078125)), pitch(10, px(10.4921875))]).toEqual([877, 1315, 1268, 616, 769, 672]);
  });

  it('the truncating basis of the base engine gives 876, 1314, 1266, 615, 768, 671: each rule moves its probe by the measured LU', () => {
    const truncNumber = (size: number, f: number): number => percentOf(fromCssPx(size), Math.fround(f * 100));
    expect([truncNumber(13.7, 1), truncNumber(13.7, 1.5), truncNumber(9.9, 2), fromCssPx(9.6171875), fromCssPx(12.0078125), fromCssPx(10.4921875)]).toEqual([876, 1314, 1266, 615, 768, 671]);
    expect([lineHeightFromNumber(13.7, 1), lineHeightFromNumber(13.7, 1.5), lineHeightFromNumber(9.9, 2)]).toEqual([877, 1315, 1268]);
  });

  it('controls agree in both bases: 10.629px/1.2, 9.6px and 17.3px', () => {
    expect([pitch(10.629, num(1.2)), pitch(10, px(9.6)), pitch(10, px(17.3))]).toEqual([percentOf(fromCssPx(10.629), Math.fround(120)), fromCssPx(9.6), fromCssPx(17.3)]);
  });

  it('T008 probe at DPR 2, 3 and 2.625: 13.7px/1 gives 1754, 2630 and 2302 zoomed LU; 9.6px at DPR 2 gives 1229; 17.3px at DPR 3 gives 3322', () => {
    expect([pitch(13.7, num(1), 2), pitch(13.7, num(1), 3), pitch(13.7, num(1), 2.625)]).toEqual([1754, 2630, 2302]);
    expect([pitch(10, px(9.6), 2), pitch(10, px(17.3), 3)]).toEqual([1229, 3322]);
  });
});

describe('R4: min-content words are measured by cached positions (ShapeResult::CachedWidth)', () => {
  /** The width in LU of a flex item holding t in a width-0 flex row: its min-content contribution (the probe). */
  function item(t: string, size: number, dpr: number): number {
    const row = box('row', { display: 'flex', width: { kind: 'px', value: 0 } }, [box('i', {}, [text('i:text0', t, { font: ahemFont(size) })])]);
    return rect(run(box('html', {}, [row]), dpr), 'i').width;
  }

  it('Blink dispatch: one formula for single and multi-word items; CachedPositionForOffset(length) is FromFloatCeil(width), so a single word is SnappedWidth', () => {
    for (const size of [11.11, 10.3, 10.06, 10.02, 10.39, 33.33]) for (let n = 0; n < 12; n++) expect(cachedRangeWidth(0, n, size)).toBe(textAdvanceAt(n, size));
  });

  it('probe at DPR 1: 11.11px multi-word 2844 (the base engine gave 2845) and single-word 2845; 10.02px 2566, 10.3px 2637, 10.06px 2576, 10.39px 2660', () => {
    expect(item('XXX XX XXXX', 11.11, 1)).toBe(2844);
    expect(item('XXXX', 11.11, 1)).toBe(2845);
    expect(textAdvanceAt(4, 11.11)).toBe(2845);
    expect([10.02, 10.3, 10.06, 10.39].map((s) => item('XXX XX XXXX', s, 1))).toEqual([2566, 2637, 2576, 2660]);
  });

  it('probe at DPR 3: 10.3px multi-word 7910 and single-word 7911; 10.06px multi-word 7726; 10.39px 7979, 11.11px 8530, 10.02px 7696', () => {
    expect(item('XXX XX XXXX', 10.3, 3)).toBe(7910);
    expect(item('XXXX', 10.3, 3)).toBe(7911);
    expect(item('XXX XX XXXX', 10.06, 3)).toBe(7726);
    expect([10.39, 11.11, 10.02].map((s) => item('XXX XX XXXX', s, 3))).toEqual([7979, 8530, 7696]);
  });

  it('a word in the middle of an item is measured the same way: XX XXXX X at 11.11px is 2844', () => {
    expect(item('XX XXXX X', 11.11, 1)).toBe(2844);
  });

  it('max-content and line layout keep SnappedWidth per piece: a max-content item holding XXX XX XXXX at 11.11px is ceil(11 advances)', () => {
    const row = box('row', { display: 'flex', width: { kind: 'px', value: 400 } }, [box('i', { flexShrink: 0 }, [text('i:text0', 'XXX XX XXXX', { font: ahemFont(11.11) })])]);
    expect(rect(run(box('html', {}, [row]), 1), 'i').width).toBe(textAdvanceAt(11, 11.11));
  });
});

describe('R5: an initial line width is device px at every DPR', () => {
  /** The top border width in device px: the child's offset in the bordered box (zoomed LU / 64). */
  function top(w: BorderWidthValue, dpr: number, faults = NO_ENGINE_FAULTS): number {
    const s: Partial<LayoutStyle> = { borderTopWidth: w, borderRightWidth: w, borderBottomWidth: w, borderLeftWidth: w };
    const r = layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: dpr, ...neutralEnvironment({ width: 400, height: 300 }), root: box('html', {}, [box('b', s, [box('c', { height: { kind: 'px', value: 1 } })])]) }, ahemMeasurer, faults);
    if (r.kind !== 'ok') throw new Error(r.unsupported.code);
    const m = absoluteRects(r.boxes);
    return (rect(m, 'c').y - rect(m, 'b').y) / 64;
  }
  const at = (w: BorderWidthValue): number[] => [2, 3, 2.625].map((d) => top(w, d));

  it('probe (device px at DPR 2 / 3 / 2.625): initial 3/3/3, medium 6/9/7, thin 2/3/2, thick 10/15/13', () => {
    expect(at({ kind: 'device-px', value: 3 })).toEqual([3, 3, 3]);
    expect(at({ kind: 'px', value: 3 })).toEqual([6, 9, 7]);
    expect(at({ kind: 'px', value: 1 })).toEqual([2, 3, 2]);
    expect(at({ kind: 'px', value: 5 })).toEqual([10, 15, 13]);
  });

  it('at DPR 1 device px and px agree (3); the spec-reading fault initialLineWidthZoomed zooms the initial width like medium', () => {
    expect([top({ kind: 'device-px', value: 3 }, 1), top({ kind: 'px', value: 3 }, 1)]).toEqual([3, 3]);
    const spec = { ...NO_ENGINE_FAULTS, initialLineWidthZoomed: true };
    expect([2, 3, 2.625].map((d) => top({ kind: 'device-px', value: 3 }, d, spec))).toEqual([6, 9, 7]);
    expect(top({ kind: 'device-px', value: 3 }, 1, spec)).toBe(3);
  });
});
