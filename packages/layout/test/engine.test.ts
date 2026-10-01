import { describe, expect, it } from 'vitest';
import { ahemMeasurer, layout } from '../src/index.ts';
import type { LayoutBox, LayoutResult } from '../src/index.ts';
import { box, pct, px, neutralEnvironment } from './helpers.ts';

function run(root: LayoutBox, width = 400, height = 300): LayoutResult {
  return layout({ viewport: { width, height }, devicePixelRatio: 1, ...neutralEnvironment({ width, height }), root }, ahemMeasurer);
}

function widths(r: LayoutResult, ids: string[]): number[] {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return ids.map((id) => (r.boxes.find((b) => b.id === id) as { width: number }).width);
}

function flexRow(width: number, items: Partial<LayoutBox['style']>[]): LayoutBox {
  return box('root', {}, [
    box('c', { display: 'flex', width: px(width), height: px(5) }, items.map((s, i) => box(`i${i + 1}`, s))),
  ]);
}

// Chrome 145 numbers measured with Playwright 1.58.2 (probe p2 in notes/T023-slice-1.md), raw 1/64 px.
describe('flex free-space distribution matches Chrome raw LayoutUnits', () => {
  it('three grow:1 items in 100px: 2133 2134 2133', () => {
    expect(widths(run(flexRow(100, [{ flexGrow: 1 }, { flexGrow: 1 }, { flexGrow: 1 }])), ['i1', 'i2', 'i3'])).toEqual([2133, 2134, 2133]);
  });
  it('three grow:1 items in 101px: 2154 2155 2155', () => {
    expect(widths(run(flexRow(101, [{ flexGrow: 1 }, { flexGrow: 1 }, { flexGrow: 1 }])), ['i1', 'i2', 'i3'])).toEqual([2154, 2155, 2155]);
  });
  it('grow 1:2:4 in 101px: 923 1847 3694', () => {
    expect(widths(run(flexRow(101, [{ flexGrow: 1 }, { flexGrow: 2 }, { flexGrow: 4 }])), ['i1', 'i2', 'i3'])).toEqual([923, 1847, 3694]);
  });
  it('seven grow:1 items in 103px', () => {
    const items = Array.from({ length: 7 }, () => ({ flexGrow: 1 }));
    expect(widths(run(flexRow(103, items)), ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7'])).toEqual([941, 942, 941, 942, 942, 942, 942]);
  });
  it('shrink three 50px bases into 100px: 2134 2133 2133', () => {
    const items = Array.from({ length: 3 }, () => ({ flexBasis: px(50) }));
    expect(widths(run(flexRow(100, items)), ['i1', 'i2', 'i3'])).toEqual([2134, 2133, 2133]);
  });
  it('shrink three 50px bases into 101px: 2155 2154 2155', () => {
    const items = Array.from({ length: 3 }, () => ({ flexBasis: px(50) }));
    expect(widths(run(flexRow(101, items)), ['i1', 'i2', 'i3'])).toEqual([2155, 2154, 2155]);
  });
  it('shrink 40/47/61 bases into 100px: 1730 2032 2638', () => {
    expect(widths(run(flexRow(100, [{ flexBasis: px(40) }, { flexBasis: px(47) }, { flexBasis: px(61) }])), ['i1', 'i2', 'i3'])).toEqual([1730, 2032, 2638]);
  });
});

function ys(r: LayoutResult, ids: string[]): number[] {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return ids.map((id) => (r.boxes.find((b) => b.id === id) as { y: number }).y);
}

function heights(r: LayoutResult, ids: string[]): number[] {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return ids.map((id) => (r.boxes.find((b) => b.id === id) as { height: number }).height);
}

// CSS2 §8.3.1, numbers from fixtures margin-collapse-* against Chrome 145 (raw LU relative to the parent border box).
describe('margin collapsing', () => {
  const frame = (kids: ReturnType<typeof box>[]) => box('root', {}, [box('f', { borderTopWidth: px(1), borderBottomWidth: px(1) }, kids)]);
  it('siblings: largest positive plus most negative', () => {
    const r = run(frame([box('a', { height: px(10), marginBottom: px(12) }), box('b', { height: px(10), marginTop: px(7), marginBottom: px(-5) }), box('c', { height: px(10), marginTop: px(9.5) })]));
    expect(ys(r, ['a', 'b', 'c'])).toEqual([64, 23 * 64, 37.5 * 64]);
  });
  it('a collapse-through box sits where a non-zero bottom border would put it, and its margins join the next', () => {
    const r = run(frame([box('a', { height: px(10), marginBottom: px(6) }), box('e', { marginTop: px(12), marginBottom: px(7) }), box('b', { height: px(10), marginTop: px(4) })]));
    expect(ys(r, ['a', 'e', 'b'])).toEqual([64, 23 * 64, 23 * 64]);
  });
  it('a child margin escapes a parent with no border or padding', () => {
    const r = run(box('root', {}, [box('p', {}, [box('c', { height: px(10), marginTop: px(7) })])]));
    expect(ys(r, ['p', 'c'])).toEqual([7 * 64, 0]);
    expect(heights(r, ['p'])).toEqual([10 * 64]);
  });
  it('Chrome deviation min-max-end-margin: min-height that changes the height drops the last child bottom margin', () => {
    const r = run(frame([box('p', { minHeight: px(20), marginBottom: px(4) }, [box('c', { height: px(12), marginBottom: px(20) })]), box('x', { height: px(10), marginTop: px(6) })]));
    expect(heights(r, ['p'])).toEqual([20 * 64]);
    expect(ys(r, ['x'])).toEqual([27 * 64]);
  });
});

describe('flex auto margins and distribution', () => {
  it('main-axis auto margins take positive free space as rounded cumulative shares', () => {
    const col = box('root', {}, [box('c', { display: 'flex', flexDirection: 'column', width: px(40), height: px(97) }, [
      box('a', { width: px(20), height: px(13) }),
      box('b', { width: px(20), height: px(13), marginTop: { kind: 'auto' } }),
      box('d', { width: px(20), height: px(13), marginTop: { kind: 'auto' }, marginBottom: { kind: 'auto' } }),
    ])]);
    expect(ys(run(col), ['a', 'b', 'd'])).toEqual([0, 2069, 4139]);
  });
  it('negative free space zeroes auto margins and justify-content applies', () => {
    const r = run(box('root', {}, [box('c', { display: 'flex', width: px(100), height: px(20), justifyContent: 'center' }, [
      box('a', { width: px(45), flexShrink: 0, marginLeft: { kind: 'auto' }, marginRight: { kind: 'auto' } }),
      box('b', { width: px(45), flexShrink: 0 }),
      box('d', { width: px(45), flexShrink: 0 }),
    ])]));
    if (r.kind !== 'ok') throw new Error('unsupported');
    expect(r.boxes.find((b) => b.id === 'a')?.x).toBe(-17.5 * 64);
  });
  it('align-content space-around: truncated leading share plus rounded cumulative shares (flex-align-content-odd, d)', () => {
    const items = Array.from({ length: 7 }, (_, i) => box(`i${i}`, { width: px(25), height: px(11) }));
    const r = run(box('root', {}, [box('w', { display: 'flex', flexWrap: 'wrap', width: px(60), height: px(67.3), rowGap: px(2), alignContent: 'space-around' }, items)]));
    expect(ys(r, ['i0', 'i2', 'i4', 'i6'])).toEqual([138, 1247, 2356, 3464]);
  });
});

describe('engine refuses what milestone 1 does not support yet', () => {
  it('percentage height against a stretched size that is not definite returns percent-height-flex', () => {
    const r = run(box('root', {}, [box('c', { display: 'flex' }, [box('i', {}, [box('k', { height: pct(50) })]), box('j', { height: px(10) })])]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('percent-height-flex');
  });
  it('intrinsic inline size of a multi-line column container returns flex-intrinsic-wrap-column', () => {
    const r = run(box('root', {}, [box('h', { display: 'flex', alignItems: 'flex-start' }, [box('w', { display: 'flex', flexDirection: 'column', flexWrap: 'wrap', height: px(10) })])]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('flex-intrinsic-wrap-column');
  });
  it('align-content: baseline returns flex-baseline', () => {
    const r = run(box('root', {}, [box('w', { display: 'flex', flexWrap: 'wrap', alignContent: 'baseline', width: px(10) }, [box('a', { width: px(5) })])]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('flex-baseline');
  });
});

