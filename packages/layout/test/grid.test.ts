// GRID G1a engine checks beside the G-P differential test (packages/parity/test/grid-corpus-*.test.ts): the grid arithmetic
// helpers, the validator's grid shape rules with a planted input for each, and small engine cases pinned to Chrome 145 corpus values.
import { describe, expect, it } from 'vitest';
import type { GridContainerStyle, GridItemStyle, LayoutBox, LayoutInput, TrackSize } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, layout, validateLayoutInput } from '../src/index.ts';
import type { LU } from '../src/units.ts';
import { equalShare, frLeftover, frShareToLu, intDiv, intMod, rawOverFloat, setFlexFactor } from '../src/units.ts';
import { box } from './helpers.ts';

const fr = (value: number): TrackSize => ({ kind: 'breadth', breadth: { kind: 'fr', value } });
const px = (value: number): TrackSize => ({ kind: 'breadth', breadth: { kind: 'px', value } });
const AUTO: TrackSize = { kind: 'breadth', breadth: { kind: 'auto' } };

function gridStyle(over: Partial<GridContainerStyle>): GridContainerStyle {
  return { templateColumns: [], templateRows: [], autoColumns: [AUTO], autoRows: [AUTO], explicitColumnCount: 0, explicitRowCount: 0, autoFlow: 'row', dense: false, justifyItems: 'normal', ...over };
}

const autoItem: GridItemStyle = { column: { kind: 'auto', span: 1 }, row: { kind: 'auto', span: 1 }, justifySelf: 'auto' };

function input(root: LayoutBox): LayoutInput {
  return { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root };
}

function grid(g: GridContainerStyle, items: readonly LayoutBox[], width = 100): LayoutBox {
  return box('g', { display: 'grid', width: { kind: 'px', value: width }, grid: g }, items.map((b) => ({ ...b, style: { ...b.style, gridItem: b.style.gridItem ?? autoItem } })));
}

function boxesOf(root: LayoutBox): Map<string, { x: number; y: number; width: number; height: number }> {
  const r = layout(input(box('root', {}, [root])), ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(`unsupported: ${r.unsupported.code}`);
  return new Map([...absoluteRects(r.boxes)].map(([id, b]) => [id, { x: b.x, y: b.y, width: b.width, height: b.height }]));
}

describe('grid arithmetic (units.ts)', () => {
  it('an equal share wraps in unsigned 32-bit arithmetic and truncates (Blink TSA:647, GR5)', () => {
    expect(equalShare(6400 as LU, 1, 3)).toBe(2133);
    expect(equalShare(6400 as LU, 2, 3)).toBe(4266);
    // 2^31 - 1 raw units times 4 tracks wraps modulo 2^32 before the division, as int * wtf_size_t does.
    expect(equalShare(2147483647 as LU, 4, 4)).toBe(1073741823);
    expect(equalShare(1073741824 as LU, 4, 1)).toBe(0);
    expect(() => equalShare(64 as LU, 1, 0)).toThrow(/positive divisor/);
  });

  it('fr shares are float32 with the leftover carried and FLT_EPSILON added (GR12): 1fr x3 over 100px is 2133 x3', () => {
    const f = rawOverFloat(6400 as LU, 3);
    let leftover = 0;
    const sizes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const share = Math.fround(Math.fround(f * setFlexFactor(1, 1)) + leftover);
      const lu = frShareToLu(share);
      sizes.push(lu);
      leftover = frLeftover(share, lu);
    }
    expect(sizes).toEqual([2133, 2133, 2133]);
  });

  it('integer division and remainder truncate toward zero, as C++ does', () => {
    expect(intDiv(-7, 2)).toBe(-3);
    expect(intMod(-7, 2)).toBe(-1);
    expect(intMod(7, 3)).toBe(1);
    expect(() => intDiv(1, 0)).toThrow(/non-zero divisor/);
  });
});

describe('the validator\'s grid rules, each with a planted input', () => {
  const ok = input(box('root', {}, [grid(gridStyle({ templateColumns: [{ count: 2, sizes: [fr(1)] }], explicitColumnCount: 2 }), [box('a', {})])]));
  const codes = (v: unknown): string[] => {
    const r = validateLayoutInput(JSON.parse(JSON.stringify(v)));
    return r.ok ? [] : r.errors.map((e) => `${e.code} ${e.path}`);
  };
  const mutate = (f: (root: { children: { style: Record<string, unknown>; children: { style: Record<string, unknown>; boxType: string }[] }[] }) => void): unknown => {
    const copy = JSON.parse(JSON.stringify(ok)) as { root: Parameters<typeof f>[0] };
    f(copy.root);
    return copy;
  };
  it('accepts a grid container with placed children', () => {
    expect(codes(ok)).toEqual([]);
  });
  it('rejects a grid style without display: grid, and display: grid without one', () => {
    expect(codes(mutate((r) => { (r.children[0] as { style: Record<string, unknown> }).style['display'] = 'block'; }))).toContain('grid-shape $.root.children[0].style.grid');
    expect(codes(mutate((r) => { (r.children[0] as { style: Record<string, unknown> }).style['grid'] = null; }))).toContain('grid-shape $.root.children[0].style.grid');
  });
  it('rejects an in-flow grid child without a placement, and a placement outside a grid container', () => {
    expect(codes(mutate((r) => { (r.children[0]?.children[0] as { style: Record<string, unknown> }).style['gridItem'] = null; }))).toContain('grid-shape $.root.children[0].children[0].style.gridItem');
    const outside = input(box('root', { gridItem: autoItem }, []));
    expect(codes(outside)).toContain('grid-shape $.root.style.gridItem');
    const inside = input(box('root', {}, [box('b', { gridItem: autoItem })]));
    expect(codes(inside)).toContain('grid-shape $.root.children[0].style.gridItem');
  });
  it('rejects a flexible minimum, reversed or out-of-range lines, a zero span and an explicit count below the template', () => {
    const g = (over: Partial<GridContainerStyle>, item: GridItemStyle = autoItem): unknown => input(box('root', {}, [grid(gridStyle(over), [box('a', { gridItem: item })])]));
    expect(codes(g({ templateColumns: [{ count: 1, sizes: [{ kind: 'minmax', min: { kind: 'fr', value: 1 }, max: { kind: 'auto' } }] }], explicitColumnCount: 1 }))).toContain('grid-shape $.root.children[0].style.grid.templateColumns');
    expect(codes(g({}, { ...autoItem, column: { kind: 'definite', start: 3, end: 3 } }))).toContain('grid-shape $.root.children[0].children[0].style.gridItem.column');
    expect(codes(g({}, { ...autoItem, row: { kind: 'definite', start: -10000001, end: 1 } }))).toContain('grid-shape $.root.children[0].children[0].style.gridItem.row');
    expect(codes(g({}, { ...autoItem, row: { kind: 'auto', span: 0 } }))).toContain('bad-value $.root.children[0].children[0].style.gridItem.row.span');
    expect(codes(g({ templateRows: [{ count: 3, sizes: [px(5)] }], explicitRowCount: 2 }))).toContain('grid-shape $.root.children[0].style.grid');
    expect(codes(g({ autoColumns: [] }))).toContain('bad-value $.root.children[0].style.grid.autoColumns');
  });
  it('rejects text directly in a grid container and an anonymous item that is not auto-placed', () => {
    const textIn = input(box('root', {}, [grid(gridStyle({}), [])]));
    (textIn.root.children[0] as unknown as { children: unknown[] }).children = [{ kind: 'text', id: 't', text: 'X', font: { family: 'Ahem', size: 10 }, lineHeight: { kind: 'normal' }, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap' }];
    expect(codes(textIn)).toContain('text-in-flex $.root.children[0].children');
    const anonymous = mutate((r) => {
      const a = r.children[0]?.children[0] as { boxType: string; style: Record<string, unknown> };
      a.boxType = 'anonymous';
      a.style['gridItem'] = { ...autoItem, justifySelf: 'center' };
    });
    expect(codes(anonymous).some((c) => c.startsWith('grid-shape $.root.children[0].children[0].style.gridItem'))).toBe(true);
  });
});

describe('grid engine cases pinned to the Chrome 145 corpus (docs/research/grid-spike/probe, DPR 1, ltr)', () => {
  it('s-fr-three-sets: 1fr 1fr 1fr over 100px gives 2133 raw units each (float32 leftover)', () => {
    const m = boxesOf(grid(gridStyle({ templateColumns: [{ count: 1, sizes: [fr(1)] }, { count: 1, sizes: [fr(1)] }, { count: 1, sizes: [fr(1)] }], explicitColumnCount: 3 }), ['a', 'b', 'c'].map((id) => box(id, { height: { kind: 'px', value: 10 } }))));
    expect(['a', 'b', 'c'].map((id) => m.get(id)?.width)).toEqual([2133, 2133, 2133]);
  });
  it('s-stretch-remainder: auto auto auto stretched over 100px gives 2133, 2133, 2134 (the remainder goes to the last set)', () => {
    const m = boxesOf(grid(gridStyle({ templateColumns: [{ count: 1, sizes: [AUTO] }, { count: 1, sizes: [AUTO] }, { count: 1, sizes: [AUTO] }], explicitColumnCount: 3 }), ['a', 'b', 'c'].map((id) => box(id, { height: { kind: 'px', value: 10 } }))));
    expect(['a', 'b', 'c'].map((id) => m.get(id)?.width)).toEqual([2133, 2133, 2134]);
  });
  it('p-dense: dense packing fills the hole before an earlier item', () => {
    const span = (n: number): GridItemStyle => ({ ...autoItem, column: { kind: 'auto', span: n } });
    const items = [span(3), span(2), autoItem, autoItem, span(3)].map((gi, k) => box(`i${k}`, { height: { kind: 'px', value: 5 }, gridItem: gi }));
    const m = boxesOf(grid(gridStyle({ templateColumns: [{ count: 4, sizes: [px(20)] }], explicitColumnCount: 4, autoRows: [px(10)], dense: true }), items));
    expect(m.get('i2')?.y).toBe(m.get('g')?.y);
  });
});
