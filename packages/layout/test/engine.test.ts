import { describe, expect, it } from 'vitest';
import { ahemMeasurer, layout } from '../src/index.ts';
import type { LayoutBox, LayoutResult } from '../src/index.ts';
import { box, px } from './helpers.ts';

function run(root: LayoutBox, width = 400, height = 300): LayoutResult {
  return layout({ viewport: { width, height }, root }, ahemMeasurer);
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

describe('engine refuses what S1 does not support', () => {
  it('two non-zero adjoining margins return margin-collapse', () => {
    const r = run(box('root', {}, [box('a', { height: px(10), marginBottom: px(5) }), box('b', { height: px(10), marginTop: px(5) })]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('margin-collapse');
  });
  it('wrapping text returns multi-line-text', () => {
    const t = { kind: 'text', id: 't', text: 'XX XX', font: { family: 'Ahem', size: 10 }, lineHeight: { kind: 'normal' } } as const;
    const r = run(box('root', {}, [box('a', { width: px(30) }, [t])]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('multi-line-text');
  });
  it('rtl returns direction-rtl', () => {
    const r = run(box('root', { direction: 'rtl' }));
    expect(r.kind === 'unsupported' && r.unsupported.specSection).toBe('css-writing-modes-4 §2.1');
  });
  it('order returns flex-order', () => {
    const r = run(flexRow(100, [{ order: 1 }]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('flex-order');
  });
});

describe('single zero-margin collapse cases lay out normally', () => {
  it('a child margin escapes a parent with no border or padding', () => {
    const r = run(box('root', {}, [box('p', {}, [box('c', { height: px(10), marginTop: px(7) })])]));
    if (r.kind !== 'ok') throw new Error('unsupported');
    expect(r.boxes.find((b) => b.id === 'p')).toMatchObject({ y: 7 * 64, height: 10 * 64 });
    expect(r.boxes.find((b) => b.id === 'c')).toMatchObject({ y: 0 });
  });
});
