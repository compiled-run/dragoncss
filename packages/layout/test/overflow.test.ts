// OVFL Phase A in the engine: the overflow values and the §3.1 computed pair, which values make scroll containers, and the
// scrollable overflow port (overflow.ts) on small trees, in raw LayoutUnits. Chrome agreement is proven on the fixtures by
// packages/parity/test/ovfl-metrics.test.ts; these pin the rules the port follows.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ahemMeasurer, layout, NO_ENGINE_FAULTS, validateLayoutInput } from '../src/index.ts';
import type { LayoutBox, LayoutInput, LayoutStyle, Overflow, ReplacedLeaf } from '../src/index.ts';
import { isScrollContainer } from '../src/box.ts';
import type { PlacedLine } from '../src/inline.ts';
import { ZERO } from '../src/units.ts';
import { OverflowRefusal, PLACED_LINE_FIELDS, refuseLineLevelBoxes, scrollMetrics, scrollMetricsWithFaults, scrollRanges } from '../src/overflow.ts';
import { box, br, divStyle, neutralEnvironment, pct, px, span, text } from './helpers.ts';

const input = (children: (LayoutBox | ReplacedLeaf)[], html: Partial<LayoutStyle> = {}): LayoutInput => ({
  viewport: { width: 400, height: 300 },
  devicePixelRatio: 1,
  ...neutralEnvironment({ width: 400, height: 300 }),
  root: box('html', html, [box('body', {}, children)]),
});
const sc = (o: Overflow, extra: Partial<LayoutStyle> = {}): Partial<LayoutStyle> => ({ overflowX: o, overflowY: o, width: px(100), height: px(100), ...extra });
const pad = (v: number): Partial<LayoutStyle> => ({ paddingTop: px(v), paddingRight: px(v), paddingBottom: px(v), paddingLeft: px(v) });
const lu = (v: number): number => v * 64;

function metrics(i: LayoutInput, direction: 'ltr' | 'rtl' = 'ltr') {
  const r = scrollMetrics(i, ahemMeasurer, direction);
  if (r.kind !== 'ok') throw new Error(r.detail);
  return r;
}
const size = (i: LayoutInput, id: string): [number, number, number, number] => {
  const m = metrics(i).containers.find((c) => c.id === id);
  if (m === undefined) throw new Error(`${id} is not a scroll container`);
  return [m.scrollRect.width, m.scrollRect.height, m.clientWidth, m.clientHeight];
};

describe('overflow values', () => {
  it('auto, scroll and hidden make scroll containers; clip and visible do not', () => {
    for (const o of ['hidden', 'auto', 'scroll'] as const) expect(isScrollContainer({ ...divStyle, overflowX: o, overflowY: o }), o).toBe(true);
    for (const o of ['visible', 'clip'] as const) expect(isScrollContainer({ ...divStyle, overflowX: o, overflowY: o }), o).toBe(false);
    expect(isScrollContainer({ ...divStyle, overflowX: 'hidden', overflowY: 'auto' })).toBe(true);
  });

  it('the validator accepts §3.1 computed pairs only', () => {
    const ok = (x: Overflow, y: Overflow): boolean => validateLayoutInput(JSON.parse(JSON.stringify(input([box('a', { overflowX: x, overflowY: y })])))).ok;
    expect(ok('hidden', 'auto')).toBe(true);
    expect(ok('scroll', 'hidden')).toBe(true);
    expect(ok('clip', 'visible')).toBe(true);
    expect(ok('clip', 'clip')).toBe(true);
    expect(ok('visible', 'auto')).toBe(false);
    expect(ok('clip', 'hidden')).toBe(false);
    expect(ok('visible', 'scroll')).toBe(false);
  });

  it('clip keeps margin collapsing: a child margin collapses through a clip box but not through an auto one', () => {
    const child = (): LayoutBox => box('k', { marginTop: px(7), height: px(10) });
    const at = (o: Overflow): number => {
      const r = layout(input([box('c', { overflowX: o, overflowY: o }, [child()])]), ahemMeasurer);
      if (r.kind !== 'ok') throw new Error('unsupported');
      return (r.boxes.find((b) => b.id === 'k') as { y: number }).y;
    };
    expect(at('clip')).toBe(0);
    expect(at('auto')).toBe(lu(7));
  });
});

describe('scrollable overflow (Blink ScrollableOverflowCalculator)', () => {
  it('the end padding counts after in-flow content: a 300px child in a 100px box with padding 10 scrolls 320', () => {
    expect(size(input([box('s', sc('auto', pad(10)), [box('k', { width: px(300), height: px(300) })])]), 's')).toEqual([lu(320), lu(320), lu(120), lu(120)]);
  });

  it('the child margins count, the end padding after them', () => {
    expect(size(input([box('s', sc('auto'), [box('k', { width: px(300), height: px(300), marginTop: px(20), marginRight: px(20), marginBottom: px(20), marginLeft: px(20) })])]), 's')).toEqual([lu(340), lu(340), lu(100), lu(100)]);
  });

  it('an absolutely positioned child adds its border box but no end padding', () => {
    const s = box('s', sc('auto', { ...pad(10), position: 'relative' }), [box('a', { position: 'absolute', left: px(0), top: px(0), width: px(300), height: px(300) })]);
    expect(size(input([s]), 's')).toEqual([lu(300), lu(300), lu(120), lu(120)]);
  });

  it('a relative offset moves the child box but not the in-flow bounds that take the end padding', () => {
    const s = box('s', sc('auto', pad(10)), [box('k', { position: 'relative', left: px(20), top: px(20), width: px(300), height: px(300) })]);
    expect(size(input([s]), 's')).toEqual([lu(330), lu(330), lu(120), lu(120)]);
  });

  it('content that fits scrolls the client size', () => {
    expect(size(input([box('s', sc('scroll', pad(10)), [box('k', { width: px(30), height: px(30) })])]), 's')).toEqual([lu(120), lu(120), lu(120), lu(120)]);
  });

  it('a nested scroll container adds its border box only; a visible one adds its overflow', () => {
    const big = (): LayoutBox => box('w', { width: px(500), height: px(500) });
    expect(size(input([box('s', sc('auto'), [box('i', sc('hidden', { width: px(50), height: px(50) }), [big()])])]), 's')).toEqual([lu(100), lu(100), lu(100), lu(100)]);
    expect(size(input([box('s', sc('auto'), [box('v', { width: px(50), height: px(50) }, [big()])])]), 's')).toEqual([lu(500), lu(500), lu(100), lu(100)]);
  });

  it('rtl overflow extends to the left; the width counts it', () => {
    const s = box('s', sc('auto', { direction: 'rtl' }), [box('k', { width: px(300), height: px(10) })]);
    const m = metrics(input([s])).containers[0];
    expect(m?.scrollRect.x).toBe(lu(-200));
    expect(m?.scrollRect.width).toBe(lu(300));
  });

  it('the viewport takes the root margin box', () => {
    const v = metrics(input([box('t', { width: px(450), height: px(380) })], { marginBottom: px(14) })).viewport;
    expect([v.scrollRect.width, v.scrollRect.height, v.clientWidth, v.clientHeight]).toEqual([lu(450), lu(394), lu(400), lu(300)]);
  });

  it('planted faults gutterReserved and overflowIgnoresPadding move the numbers', () => {
    const i = input([box('s', sc('auto', pad(10)), [box('k', { width: px(300), height: px(300) })])]);
    const g = scrollMetricsWithFaults(i, ahemMeasurer, 'ltr', { ...NO_ENGINE_FAULTS, gutterReserved: true });
    const p = scrollMetricsWithFaults(i, ahemMeasurer, 'ltr', { ...NO_ENGINE_FAULTS, overflowIgnoresPadding: true });
    expect(g.kind === 'ok' ? g.containers[0]?.clientWidth : null).toBe(lu(105));
    expect(p.kind === 'ok' ? p.containers[0]?.scrollRect.width : null).toBe(lu(310));
  });

  it('a grid container is refused, whether it scrolls or sits in a scroll container or the viewport, never measured as a block', () => {
    const g = (style: Partial<LayoutStyle>): LayoutBox => {
      const item = box('a', { height: px(150), gridItem: { column: { kind: 'auto', span: 1 }, row: { kind: 'auto', span: 1 }, justifySelf: 'auto' } });
      const grid = { templateColumns: [], templateRows: [], autoColumns: [{ kind: 'breadth' as const, breadth: { kind: 'auto' as const } }], autoRows: [{ kind: 'breadth' as const, breadth: { kind: 'auto' as const } }], explicitColumnCount: 0, explicitRowCount: 0, autoRepeatColumns: null, autoRepeatRows: null, autoFlow: 'row' as const, dense: false, justifyItems: 'normal' as const };
      return box('g', { display: 'grid', grid, ...style }, [item]);
    };
    for (const i of [input([g(sc('auto'))]), input([box('s', sc('auto'), [g({})])]), input([g({})])]) {
      expect(validateLayoutInput(JSON.parse(JSON.stringify(i))).ok).toBe(true);
      expect(layout(i, ahemMeasurer).kind).toBe('ok');
      const r = scrollMetrics(i, ahemMeasurer, 'ltr');
      expect(r.kind === 'refused' ? [r.nodeId, r.detail] : r.kind).toEqual(['g', expect.stringContaining('a grid container')]);
    }
  });

  it('a relative offset with a percentage top inside a scroll container is refused, not guessed', () => {
    const r = scrollMetrics(input([box('s', sc('auto'), [box('k', { position: 'relative', top: pct(10), height: px(10) })])]), ahemMeasurer, 'ltr');
    expect(r.kind).toBe('refused');
    expect(r.kind === 'refused' ? r.nodeId : '').toBe('k');
  });
});

describe('line items (R16: a new PlacedLine item kind is never skipped)', () => {
  const unhandled = (line: object): string[] => Object.keys(line).filter((k) => !PLACED_LINE_FIELDS.includes(k));
  it('addLines accounts for every PlacedLine field; a stub item kind is caught', () => {
    expectTypeOf<keyof PlacedLine>().toEqualTypeOf<'top' | 'height' | 'baseline' | 'pieces' | 'boxes' | 'boxRects' | 'breaks' | 'breakRects'>();
    const line: PlacedLine = { top: ZERO, height: ZERO, baseline: ZERO, pieces: [], boxes: [], boxRects: [], breaks: [], breakRects: [] };
    expect(unhandled(line)).toEqual([]);
    expect(unhandled({ ...line, atomics: [] })).toEqual(['atomics']);
  });
});

describe('replaced leaves and line-level boxes (pre-landing review of #96)', () => {
  const replaced = (id: string, style: Partial<LayoutStyle>): ReplacedLeaf => ({ kind: 'replaced', id, style: { ...divStyle, ...style }, natural: { kind: 'image', width: 160, height: 80 }, defaultWidth: 300, defaultHeight: 150, objectFit: 'fill', objectPositionX: { kind: 'percent', value: 50 }, objectPositionY: { kind: 'percent', value: 50 } });
  it('a replaced child adds its border box to its scroll container: a 100x200 image in a 100x50 auto box scrolls 200 high', () => {
    const img = replaced('img', { display: 'block', width: px(100), height: px(200) });
    expect(size(input([box('s', sc('auto', { height: px(50) }), [img])]), 's')).toEqual([lu(100), lu(200), lu(100), lu(50)]);
  });

  it('a replaced child takes part in the in-flow bounds: its margins and the end padding count', () => {
    const img = replaced('img', { display: 'block', width: px(30), height: px(150), marginBottom: px(7), marginLeft: px(5) });
    expect(size(input([box('s', sc('auto', pad(10)), [img])]), 's')).toEqual([lu(120), lu(10 + 150 + 7 + 10), lu(120), lu(120)]);
  });

  it('an atomic inline (a box child of an inline formatting context) is refused as an OverflowRefusal, never a plain error', () => {
    const ifc = box('s', sc('auto'), [text('t', 'XX')]);
    expect(() => refuseLineLevelBoxes(ifc)).not.toThrow();
    const atomic = { ...ifc, children: [...ifc.children, box('k', { width: px(10), height: px(10) })] };
    expect(() => refuseLineLevelBoxes(atomic)).toThrow(OverflowRefusal);
    expect(() => refuseLineLevelBoxes(atomic)).toThrow('an atomic inline in the inline formatting context of s');
  });

  it('an inline box or a <br> in an inline formatting context (INL1a line items addLines does not measure) is refused', () => {
    const withSpan = box('s', sc('auto'), [text('t', 'XX'), span('i', [text('u', 'YY')])]);
    expect(() => refuseLineLevelBoxes(withSpan)).toThrow('an inline box in the inline formatting context of s');
    const r = scrollMetrics(input([withSpan]), ahemMeasurer, 'ltr');
    expect(r.kind === 'refused' ? [r.nodeId, r.detail] : r.kind).toEqual(['i', expect.stringContaining('(R16, INL1a)')]);
    // Only inline boxes, no text of its own: still an inline formatting context, never measured as an empty block.
    const onlySpan = box('s', sc('auto'), [span('i', [text('u', 'YY')])]);
    expect(() => refuseLineLevelBoxes(onlySpan)).toThrow(OverflowRefusal);
    const withBr = box('s', sc('auto'), [text('t', 'XX'), br('b'), text('v', 'YY')]);
    expect(() => refuseLineLevelBoxes(withBr)).toThrow('a <br> in the inline formatting context of s');
  });

  it('scrollRanges decides each scroll container on its own: an undecided one is listed refused, the others and the viewport do not refuse', () => {
    // An inline box outside every scroll container: scrollMetrics refuses (the viewport reads it), scrollRanges gives every range.
    const outside = input([box('p', {}, [text('t', 'XX'), span('i', [text('u', 'YY')])]), box('a', sc('auto'), [box('c', { width: px(300), height: px(10) })])]);
    expect(scrollMetrics(outside, ahemMeasurer, 'ltr').kind).toBe('refused');
    const r = scrollRanges(outside, ahemMeasurer);
    expect(r).toEqual({ kind: 'ok', ranges: [{ id: 'a', minX: 0, maxX: 200, minY: 0, maxY: 0 }], refused: [] });
    // An inline box inside one scroll container: that one is refused, naming the node and the rule; the other keeps its range.
    const inside = input([box('s', sc('auto'), [text('t', 'XX'), span('i', [text('u', 'YY')])]), box('a', sc('hidden'), [box('c', { width: px(10), height: px(300) })])]);
    const q = scrollRanges(inside, ahemMeasurer);
    if (q.kind !== 'ok') throw new Error(q.detail);
    expect(q.ranges).toEqual([{ id: 'a', minX: 0, maxX: 0, minY: 0, maxY: 200 }]);
    expect(q.refused).toEqual([{ id: 's', nodeId: 'i', detail: expect.stringContaining('(R16, INL1a)') }]);
  });
});

describe('reversed flex scroll containers overflow past their start (Blink LayoutFlexibleBox overflow sides; #194 review)', () => {
  const flex = (extra: Partial<LayoutStyle>, kid: Partial<LayoutStyle>) => input([box('s', sc('hidden', { display: 'flex', ...extra }), [box('k', { flexShrink: 0, ...kid })])]);
  const rect = (i: LayoutInput) => (metrics(i).containers[0] as { scrollRect: { x: number; y: number; width: number; height: number } }).scrollRect;

  it('row-reverse: a 300px item in a 100px container scrolls 300 wide, its overflow on the left in ltr and on the right in rtl', () => {
    expect(rect(flex({ flexDirection: 'row-reverse' }, { width: px(300), height: px(10) }))).toMatchObject({ x: lu(-200), width: lu(300) });
    expect(rect(flex({ flexDirection: 'row-reverse', direction: 'rtl' }, { width: px(300), height: px(10) }))).toMatchObject({ x: 0, width: lu(300) });
    expect(rect(flex({ flexDirection: 'row' }, { width: px(300), height: px(10) }))).toMatchObject({ x: 0, width: lu(300) });
  });

  it('column-reverse and wrap-reverse overflow past the top', () => {
    expect(rect(flex({ flexDirection: 'column-reverse' }, { width: px(10), height: px(300) }))).toMatchObject({ y: lu(-200), height: lu(300) });
    expect(rect(flex({ flexWrap: 'wrap-reverse' }, { width: px(10), height: px(300) }))).toMatchObject({ y: lu(-200), height: lu(300) });
    expect(rect(flex({ flexDirection: 'column', flexWrap: 'wrap-reverse' }, { width: px(300), height: px(10) }))).toMatchObject({ x: lu(-200), width: lu(300) });
  });
});
