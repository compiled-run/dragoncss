import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layout, layoutWithFaults, NO_ENGINE_FAULTS, validateLayoutInput } from '../src/index.ts';
import type { EngineFaults, LayoutBox, LayoutRect, LayoutResult, LayoutStyle, TextLeaf } from '../src/index.ts';
import * as u from '../src/units.ts';
import { anon, box, px, text } from './helpers.ts';

// S4a engine features, pinned in raw LayoutUnits measured in Chrome 145 (probes and fixtures named per test, notes/T035-slice-4a.md).
const G = 640;

function run(root: LayoutBox, faults: EngineFaults = NO_ENGINE_FAULTS): LayoutResult {
  return layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root }, ahemMeasurer, faults);
}

function abs(r: LayoutResult): Map<string, LayoutRect> {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return absoluteRects(r.boxes);
}

const xs = (r: LayoutResult, ids: string[]): number[] => ids.map((id) => (abs(r).get(id) as LayoutRect).x);
const ys = (r: LayoutResult, ids: string[]): number[] => ids.map((id) => (abs(r).get(id) as LayoutRect).y);
const t = (id: string, value: string, over: Partial<TextLeaf> = {}): TextLeaf => text(id, value, over);
const rtl: Partial<LayoutStyle> = { direction: 'rtl' };
const one = px(1);
const border = { borderTopWidth: one, borderRightWidth: one, borderBottomWidth: one, borderLeftWidth: one };

describe('rtl block widths and margins (CSS2 §10.3.3, fixture rtl-block-auto-margins)', () => {
  const kid = (id: string, s: Partial<LayoutStyle>) => box(id, { ...rtl, height: px(5), ...s });
  const tree = box('root', {}, [box('p', { ...rtl, width: px(101), ...border }, [
    kid('a', { width: px(40), marginLeft: px(10), marginRight: px(20) }),
    kid('c', { width: px(40.3), marginLeft: { kind: 'auto' }, marginRight: px(7) }),
    kid('e', { width: px(40), marginLeft: px(5), marginRight: { kind: 'auto' } }),
    kid('f', { width: px(120), marginLeft: { kind: 'auto' }, marginRight: { kind: 'auto' } }),
    kid('g', { width: px(120), marginLeft: px(3), marginRight: px(4) }),
  ])]);
  it('over-constrained: margin-left is ignored; a lone auto margin takes the free space; wider boxes overflow to the left', () => {
    expect(xs(run(tree), ['a', 'c', 'e', 'f', 'g'])).toEqual([2688, 3501, 384, -1152, -1408]);
  });
  it('both auto with odd free space: the start (right) margin gets LayoutUnit / 2, so rtl is one LU right of ltr', () => {
    const centred = (d: LayoutStyle['direction']) => box('root', {}, [box('p', { direction: d, width: px(101) }, [box('b', { width: px(40.3), height: px(5), marginLeft: { kind: 'auto' }, marginRight: { kind: 'auto' } })])]);
    expect(xs(run(centred('rtl')), ['b'])).toEqual([1943]);
    expect(xs(run(centred('ltr')), ['b'])).toEqual([1942]);
  });
  it('planted fault rtlAsLtr lays rtl boxes out as ltr', () => {
    expect(xs(run(tree, { ...NO_ENGINE_FAULTS, rtlAsLtr: true }), ['a'])).toEqual([64 + 640]);
  });
});

describe('rtl text-align (css-text-3 §7.1, fixture rtl-text-align-multi-line)', () => {
  const at = (align: LayoutStyle['textAlign'], width: number, value: string): number[] => {
    const r = run(box('root', rtl, [box('a', { ...rtl, width: px(width), textAlign: align }, [t('t', value)])]));
    const out: number[] = [];
    for (let j = 0; abs(r).has(`t:line${j}`); j++) out.push((abs(r).get(`t:line${j}`) as LayoutRect).x);
    return out;
  };
  it('start and right take the free space, end and left none, center LayoutUnit / 2 from the left', () => {
    expect(at('start', 55, 'XX XX XXX X')).toEqual([22400, 22400]);
    expect(at('right', 55, 'XX XX XXX X')).toEqual([22400, 22400]);
    expect(at('end', 55, 'XX XX XXX X')).toEqual([22080, 22080]);
    expect(at('left', 55, 'XX XX XXX X')).toEqual([22080, 22080]);
    expect(at('center', 55, 'XX XX XXX X')).toEqual([22240, 22240]);
    expect(at('center', 50.3, 'XX XX XXX')).toEqual([22390, 23030]);
  });
  it('an overflowing line is start-aligned, so it overflows to the left whatever the alignment', () => {
    expect(at('start', 25, 'XXXXX XX')).toEqual([22400, 24320]);
    expect(at('center', 25, 'XXXXX XX')).toEqual([22400, 24160]);
    expect(at('left', 25, 'XXXXX XX')).toEqual([22400, 24000]);
  });
  it('planted fault rtlAsLtr treats start as left', () => {
    const r = run(box('root', rtl, [box('a', { ...rtl, width: px(55) }, [t('t', 'XX XX XXX X')])]), { ...NO_ENGINE_FAULTS, rtlAsLtr: true });
    expect((abs(r).get('t:line0') as LayoutRect).x).toBe(0);
  });
});

describe('bidi in rtl paragraphs (UAX #9): only strong-L letters, space and U+200B, never ending with U+200B', () => {
  const para = (d: LayoutStyle['direction'], ...values: string[]) => run(box('root', {}, [box('a', { direction: d, width: px(55) }, values.map((v, i) => t(`t${i}`, v)))]));
  it('digits and punctuation in rtl raise bidi-neutral; the same text in ltr lays out', () => {
    for (const v of ['AB 12', 'AB.', 'X-Y', 'X~']) {
      const r = para('rtl', v);
      expect(r.kind === 'unsupported' && r.unsupported.code, v).toBe('bidi-neutral');
    }
    expect(para('ltr', 'AB 12.').kind).toBe('ok');
  });
  it('U+200B inside the paragraph is laid out; U+200B ending it (UAX #9 L1) raises bidi-neutral', () => {
    expect(para('rtl', 'XX\u200bYY').kind).toBe('ok');
    expect(para('rtl', 'XX', '\u200b', 'YY').kind).toBe('ok');
    const r = para('rtl', 'XX', '\u200b');
    expect(r.kind === 'unsupported' && r.unsupported).toMatchObject({ code: 'bidi-neutral', nodeId: 't1', specSection: 'UAX #9 L1' });
    expect(para('ltr', 'XX', '\u200b').kind).toBe('ok');
  });
  it('M3 (UAX #9 L1): U+200B followed only by spaces or U+200B at the paragraph end raises bidi-neutral, in one leaf or across leaves', () => {
    for (const leaves of [['AB\u200b '], ['AB \u200b '], ['AB\u200b', ' '], ['AB', '\u200b', ' \u200b']]) {
      const r = para('rtl', ...leaves);
      expect(r.kind === 'unsupported' && r.unsupported.code, JSON.stringify(leaves)).toBe('bidi-neutral');
      expect(r.kind === 'unsupported' && r.unsupported.specSection, JSON.stringify(leaves)).toBe('UAX #9 L1');
    }
    // A trailing space-only leaf after letters, and U+200B followed by a letter, keep logical order.
    expect(para('rtl', 'AB', ' ').kind).toBe('ok');
    expect(para('rtl', 'AB\u200b C').kind).toBe('ok');
    expect(para('ltr', 'AB\u200b ').kind).toBe('ok');
  });
});

describe('order (css-flexbox-1 §5.4, fixture flex-order)', () => {
  const tree = box('root', {}, [box('r', { display: 'flex', width: px(150), columnGap: px(2) }, [
    box('a', { width: px(20), height: px(8), order: 2 }),
    box('b', { width: px(20), height: px(12), order: -1 }),
    box('c', { width: px(20), height: px(8) }),
    box('d', { width: px(20), height: px(8), order: -1 }),
    box('e', { width: px(20), height: px(8), order: 1 }),
  ])]);
  it('order-modified document order, stable for equal values', () => {
    expect(xs(run(tree), ['b', 'd', 'c', 'e', 'a'])).toEqual([0, 1408, 2816, 4224, 5632]);
  });
  it('planted fault ignoreOrder keeps document order', () => {
    expect(xs(run(tree, { ...NO_ENGINE_FAULTS, ignoreOrder: true }), ['a', 'b', 'c', 'd', 'e'])).toEqual([0, 1408, 2816, 4224, 5632]);
  });
});

describe('reverse directions and rtl flex axes in flow coordinates (css-flexbox-1 §5.1)', () => {
  const three = (id: string, s: Partial<LayoutStyle>) => box('root', {}, [box(id, { display: 'flex', width: px(101.3), height: px(101.3), justifyContent: 'center', ...s }, ['a', 'b', 'c'].map((k) => box(`${id}${k}`, { width: px(10), height: px(10), flexShrink: 0 })))]);
  it('odd centre offsets truncate from the writing-mode start: row-reverse ltr mirrors row ltr, row rtl truncates from the right', () => {
    expect(xs(run(three('rr', { flexDirection: 'row-reverse' })), ['rra', 'rrb', 'rrc'])).toEqual([3561, 2921, 2281]);
    expect(xs(run(three('rt', { direction: 'rtl' })), ['rta', 'rtb', 'rtc'])).toEqual([3562, 2922, 2282]);
    expect(xs(run(three('rx', { flexDirection: 'row-reverse', direction: 'rtl' })), ['rxa', 'rxb', 'rxc'])).toEqual([2282, 2922, 3562]);
    expect(ys(run(three('cr', { flexDirection: 'column-reverse' })), ['cra', 'crb', 'crc'])).toEqual([3561, 2921, 2281]);
  });
  it('start is not flex-start in a reverse container; left and right are physical in a row', () => {
    expect(xs(run(three('s', { flexDirection: 'row-reverse', justifyContent: 'start' })), ['sa', 'sb', 'sc'])).toEqual([1280, 640, 0]);
    expect(xs(run(three('f', { flexDirection: 'row-reverse', justifyContent: 'flex-start' })), ['fa', 'fb', 'fc'])).toEqual([5843, 5203, 4563]);
    expect(xs(run(three('l', { direction: 'rtl', justifyContent: 'left' })), ['la', 'lb', 'lc'])).toEqual([1280, 640, 0]);
  });
});

describe('wrap-reverse (css-flexbox-1 §5.2, probe p7 and fixture flex-wrap-reverse)', () => {
  const lines = (s: Partial<LayoutStyle>) => box('root', {}, [box('w', { display: 'flex', flexWrap: 'wrap-reverse', width: px(30), height: px(101.3), alignItems: 'flex-start', ...s }, [
    box('a', { width: px(20), height: px(10), flexShrink: 0 }),
    box('b', { width: px(20), height: px(15), flexShrink: 0 }),
    box('d', { width: px(20), height: px(20), flexShrink: 0 }),
    box('s', { width: px(20), flexShrink: 0 }),
  ])]);
  it('lines stack from the bottom; align-content center truncates from the top; stretch drops the remainder at the bottom', () => {
    expect(ys(run(lines({ alignContent: 'center' })), ['a', 'b', 'd', 's'])).toEqual([4041, 3081, 1801, 1801]);
    expect(ys(run(lines({ alignContent: 'normal' })), ['a', 'b', 'd', 's'])).toEqual([5840, 3980, 1800, 900]);
    expect(ys(run(lines({ alignContent: 'start' })), ['a', 'b', 'd', 's'])).toEqual([2240, 1280, 0, 0]);
  });
});

describe('baseline alignment (css-flexbox-1 §8.3, §9.4 step 8, css-align-3 §9)', () => {
  const row = (id: string, s: Partial<LayoutStyle>, kids: LayoutBox[]) => box('root', {}, [box(id, { display: 'flex', alignItems: 'baseline', width: px(390), ...border, ...s }, kids)]);
  const item = (id: string, s: Partial<LayoutStyle>, kids: (LayoutBox | TextLeaf)[] = []) => box(id, { flexShrink: 0, ...s }, kids);
  const size = (n: number) => ({ font: { family: 'Ahem' as const, size: n } });
  it('first baselines from line boxes: font size, border and padding, line-height and margins (probe p8)', () => {
    const r = run(row('c', { height: px(100) }, [
      item('ra', {}, [t('ra:t', 'XX')]),
      item('rb', { paddingTop: px(5), borderTopWidth: px(2) }, [t('rb:t', 'XX', size(20))]),
      item('re', { width: px(10), height: px(30), marginBottom: px(4) }),
      item('rl', {}, [t('rl:t', 'XX', { lineHeight: { kind: 'px', value: 30 } })]),
      item('rm', { marginTop: px(9) }, [t('rm:t', 'X')]),
      item('ro', { overflowX: 'hidden', overflowY: 'hidden', height: px(15), paddingTop: px(4) }, [t('ro:t', 'XX')]),
    ]));
    expect(ys(r, ['ra', 'rb', 're', 'rl', 'rm', 'ro'])).toEqual([1472, 512, 64, 832, 1472, 1216]);
  });
  it('nested flex containers take their baseline group, a column container its first item (probe p8)', () => {
    const r = run(row('c', { height: px(100) }, [
      item('ra', {}, [t('ra:t', 'XX')]),
      item('rb', { paddingTop: px(5), borderTopWidth: px(2) }, [t('rb:t', 'XX', size(20))]),
      item('re', { width: px(10), height: px(30), marginBottom: px(4) }),
      item('rf', { display: 'flex', alignItems: 'baseline', paddingTop: px(1) }, [item('f1', { marginTop: px(2) }, [t('f1:t', 'X', size(30))]), item('f2', {}, [t('f2:t', 'XXX')])]),
      item('rg', { display: 'flex', flexDirection: 'column', paddingTop: px(2) }, [item('g1', {}, [t('g1:t', 'X', size(14))]), item('g2', {}, [t('g2:t', 'X')])]),
    ]));
    expect(ys(r, ['ra', 'rf', 'rg'])).toEqual([1472, 256, 1152]);
  });
  it('a box with no baseline synthesizes one at its bottom border edge (fixture flex-baseline-synthesized c1)', () => {
    const r = run(row('c1', { paddingTop: px(2) }, [
      item('t1', {}, [t('t1:t', 'X')]),
      item('e1', { width: px(10), height: px(30), marginBottom: px(4) }),
      item('e2', { width: px(12), height: px(17), borderBottomWidth: px(2), paddingBottom: px(3) }),
      item('k1', { paddingTop: px(2), width: px(8) }, [box('k1a', { height: px(9) })]),
      item('z1', { display: 'flex', width: px(12), height: px(15), borderBottomWidth: px(3) }),
      item('t2', {}, [t('t2:t', 'XX', size(20))]),
    ]));
    expect(ys(r, ['t1', 'e1', 'e2', 'k1', 'z1', 't2'])).toEqual([1600, 192, 704, 1408, 960, 1088]);
  });
  it('a scroll container baseline is clamped to its border box (fixture flex-baseline-nested c3)', () => {
    const scroll = { overflowX: 'hidden' as const, overflowY: 'hidden' as const };
    const r = run(row('c3', {}, [
      item('s0', {}, [t('s0:t', 'X')]),
      item('s1', { ...scroll, paddingTop: px(2) }, [t('s1:t', 'XX')]),
      item('s2', { paddingTop: px(3) }, [box('s2a', { ...scroll, paddingTop: px(2) }, [t('s2a:t', 'XX')])]),
      item('s3', { ...scroll, height: px(5), paddingTop: px(3) }, [t('s3:t', 'XX', size(20))]),
      item('s4', { ...scroll, height: px(5), paddingTop: px(3) }, [box('s4a', {}, [t('s4a:t', 'XX')])]),
    ]));
    expect(ys(r, ['s0', 's1', 's3', 's4'])).toEqual([384, 256, 384, 384]);
  });
  it('baseline in a column container aligns synthesized left border edges, flush with the cross-start edge (fixture flex-baseline-column-fallback)', () => {
    const col = (id: string, d: LayoutStyle['direction'], kids: LayoutBox[]) => box('root', {}, [box(id, { display: 'flex', flexDirection: 'column', alignItems: 'baseline', direction: d, width: px(101.3), ...border, paddingRight: px(3), paddingLeft: px(2) }, kids)]);
    const ltr = run(col('c1', 'ltr', [box('c1a', { width: px(10), height: px(6) }), box('c1b', { width: px(25.5), height: px(6), marginLeft: px(4) }), box('c1t', {}, [t('c1t:t', 'XX X')])]));
    expect(xs(ltr, ['c1a', 'c1b', 'c1t'])).toEqual([448, 448, 448]);
    const r = run(col('c2', 'rtl', [box('c2a', { ...rtl, width: px(10), height: px(6) }), box('c2b', { ...rtl, width: px(25.5), height: px(6), marginRight: px(7) }), box('c2c', { width: px(10), height: px(6), marginLeft: px(4) }), box('c2t', rtl, [t('c2t:t', 'XX X')])]));
    expect(xs(r, ['c2a', 'c2b', 'c2c', 'c2t'])).toEqual([4115, 4115, 4115, 4115]);
  });
  it('planted fault baselineFromBorderTop drops the item top border and padding from its baseline', () => {
    const tree = row('c', { height: px(100) }, [item('ra', {}, [t('ra:t', 'XX')]), item('rb', { paddingTop: px(5), borderTopWidth: px(2) }, [t('rb:t', 'XX', size(20))]), item('re', { width: px(10), height: px(30), marginBottom: px(4) })]);
    expect(ys(run(tree), ['ra', 'rb'])).toEqual([1472, 512]);
    expect(ys(run(tree, { ...NO_ENGINE_FAULTS, baselineFromBorderTop: true }), ['ra', 'rb'])).not.toEqual([1472, 512]);
  });
});

describe('scroll containers (css-overflow-3, css-flexbox-1 §4.5, fixture overflow-hidden-flex-min-size)', () => {
  const scroll = { overflowX: 'hidden' as const, overflowY: 'hidden' as const };
  const row = box('root', {}, [box('r1', { display: 'flex', width: px(50) }, [box('r1a', scroll, [t('a:t', 'XXXXXXXX')]), box('r1b', {}, [t('b:t', 'XXXXXXXX')])])]);
  const col = box('root', {}, [box('c1', { display: 'flex', flexDirection: 'column', width: px(50), height: px(30) }, [box('c1a', scroll, [box('c1a1', { height: px(40) })]), box('c1b', {}, [box('c1b1', { height: px(40) })])])]);
  it('the automatic minimum size of a scroll container is 0 on both axes', () => {
    expect([abs(run(row)).get('r1a')?.width, abs(run(row)).get('r1b')?.width]).toEqual([0, 5120]);
    expect([abs(run(col)).get('c1a')?.height, abs(run(col)).get('c1b')?.height]).toEqual([0, 2560]);
  });
  it('planted fault scrollMinAuto keeps the content-based minimum', () => {
    expect(abs(run(row, { ...NO_ENGINE_FAULTS, scrollMinAuto: true })).get('r1a')?.width).toBe(5120);
    expect(abs(run(col, { ...NO_ENGINE_FAULTS, scrollMinAuto: true })).get('c1a')?.height).toBe(2560);
  });
  it('a scroll container is a BFC root: no parent-child collapsing and no collapse-through (fixture overflow-hidden-bfc)', () => {
    const frame = (kids: LayoutBox[]) => box('root', {}, [box('f', { borderTopWidth: one, borderBottomWidth: one }, kids)]);
    const r = run(frame([
      box('p', { marginTop: px(10), marginBottom: px(10) }, [box('q', { ...scroll, marginTop: px(5), marginBottom: px(6) }, [box('q1', { marginTop: px(7), marginBottom: px(8), height: px(10) })])]),
      box('s1', { height: px(3) }),
      box('zero', { ...scroll, marginTop: px(9), marginBottom: px(9) }),
      box('s2', { height: px(3) }),
    ]));
    expect(ys(r, ['p', 'q', 'q1', 's1', 'zero', 's2'])).toEqual([704, 704, 1152, 2944, 3712, 4288]);
  });
});

describe('the validator (C4, C6)', () => {
  const codes = (root: LayoutBox): string[] => {
    const v = validateLayoutInput(JSON.parse(JSON.stringify({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root })));
    return v.ok ? [] : v.errors.map((e) => e.code);
  };
  it('rejects display none: the compiler omits display: none subtrees', () => {
    expect(codes(box('root', {}, [box('a', { display: 'none' as unknown as 'block' })]))).toEqual(['bad-value']);
  });
  it('rejects a mixed overflow pair (css-overflow-3 §3.1)', () => {
    expect(codes(box('root', {}, [box('a', { overflowX: 'hidden' })]))).toEqual(['bad-value']);
  });
  it('accepts a well-formed anonymous box', () => {
    expect(codes(box('root', {}, [box('p', {}, [anon('p:anon0', { direction: 'rtl', textAlign: 'center' }, [t('p:text0', 'XX')]), box('b', {})])]))).toEqual([]);
  });
  it('anonymous-shape: no children, a box child, a wrong id, a display other than block, a non-initial style', () => {
    const inP = (a: LayoutBox) => box('root', {}, [box('p', {}, [a, box('b', {})])]);
    expect(codes(inP(anon('p:anon0', {}, [])))).toEqual(['anonymous-shape']);
    expect(codes(inP(anon('p:anon0', {}, [box('x', {})])))).toEqual(['anonymous-shape']);
    expect(codes(inP(anon('p:anon0', {}, [t('p:text0', 'XX'), box('x', {})])))).toContain('anonymous-shape');
    expect(codes(inP(anon('q:anon0', {}, [t('p:text0', 'XX')])))).toEqual(['anonymous-shape']);
    expect(codes(inP(anon('p:anon', {}, [t('p:text0', 'XX')])))).toEqual(['anonymous-shape']);
    expect(codes(inP(anon('p:anon0', { display: 'flex' }, [t('p:text0', 'XX')]))).sort()).toEqual(['anonymous-shape', 'text-in-flex']);
    expect(codes(inP(anon('p:anon0', { marginTop: px(1) }, [t('p:text0', 'XX')])))).toEqual(['anonymous-shape']);
    expect(codes(inP(anon('p:anon0', { flexShrink: 0 }, [t('p:text0', 'XX')])))).toEqual(['anonymous-shape']);
    expect(codes(inP(anon('p:anon0', { width: px(5) }, [t('p:text0', 'XX')])))).toEqual(['anonymous-shape']);
  });
});

describe('Ahem metrics at fractional sizes (fixture text-fractional-font-size)', () => {
  it('ascent and descent round to the nearest whole px, an exact half down (Chrome 145 oracle)', () => {
    const m = (size: number) => ahemMeasurer.metrics({ family: 'Ahem', size });
    expect([m(12.5).ascent, m(12.5).descent]).toEqual([10 * 64, 2 * 64]);
    expect([m(10.625).ascent, m(10.625).descent]).toEqual([8 * 64, 2 * 64]);
    expect([m(12.51).ascent, m(12.51).descent]).toEqual([10 * 64, 3 * 64]);
    expect([m(13.7).ascent, m(13.7).descent]).toEqual([11 * 64, 3 * 64]);
    expect(u.roundFontMetricToWholePx(2.5)).toBe(128);
    expect(u.roundFontMetricToWholePx(2.502)).toBe(192);
  });
  it('the font instance is created at the size times 100, truncated: 10.625px shapes as 10.62px (probe p14: 1, 4 and 8 glyphs)', () => {
    const w = (n: number, size: number) => { const m = ahemMeasurer.measure('X'.repeat(n), { family: 'Ahem', size }); return m.ok ? m.measure.width : -1; };
    expect([w(1, 10.625), w(4, 10.625), w(8, 10.625)]).toEqual([680, 2719, 5438]);
    expect([w(1, 10.375), w(4, 10.375), w(8, 10.375)]).toEqual([664, 2655, 5310]);
    expect([w(1, 10.3), w(4, 10.3), w(8, 10.3)]).toEqual([660, 2637, 5274]);
    expect([u.platformFontSize(10.629), u.platformFontSize(13.7), u.platformFontSize(11.1111)]).toEqual([10.62, 13.7, 11.11]);
    // Metrics use the same size: 10.629px has ascent 8 (8.496), 10.631px ascent 9 (8.504); Chrome glyph heights 10 and 11 px.
    expect([ahemMeasurer.metrics({ family: 'Ahem', size: 10.629 }).ascent, ahemMeasurer.metrics({ family: 'Ahem', size: 10.631 }).ascent]).toEqual([512, 576]);
  });
  it('advances ceil per piece: 12.51px is raw 801 per glyph', () => {
    const w = ahemMeasurer.measure('X', { family: 'Ahem', size: 12.51 });
    expect(w.ok && w.measure.width).toBe(801);
    expect(layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root: box('root', {}, [box('a', {}, [t('a:t', 'X', { font: { family: 'Ahem', size: 12.51 } })])]) }, ahemMeasurer).kind).toBe('ok');
    void G;
  });
});
