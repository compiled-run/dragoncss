// GRID G1a engine input: the validator's grid shape rules, with a planted input for each.
import { describe, expect, it } from 'vitest';
import type { GridContainerStyle, GridItemStyle, LayoutBox, LayoutInput, TrackSize } from '../src/index.ts';
import { ahemMeasurer, layout, validateLayoutInput } from '../src/index.ts';
import { anon, box, neutralEnvironment, span, text } from './helpers.ts';

const fr = (value: number): TrackSize => ({ kind: 'breadth', breadth: { kind: 'fr', value } });
const px = (value: number): TrackSize => ({ kind: 'breadth', breadth: { kind: 'px', value } });
const AUTO: TrackSize = { kind: 'breadth', breadth: { kind: 'auto' } };

function gridStyle(over: Partial<GridContainerStyle>): GridContainerStyle {
  return { templateColumns: [], templateRows: [], autoColumns: [AUTO], autoRows: [AUTO], explicitColumnCount: 0, explicitRowCount: 0, autoFlow: 'row', dense: false, justifyItems: 'normal', ...over };
}

const autoItem: GridItemStyle = { column: { kind: 'auto', span: 1 }, row: { kind: 'auto', span: 1 }, justifySelf: 'auto' };

function input(root: LayoutBox): LayoutInput {
  const viewport = { width: 400, height: 300 };
  return { viewport, devicePixelRatio: 1, ...neutralEnvironment(viewport), root };
}

function grid(g: GridContainerStyle, items: readonly LayoutBox[], width = 100): LayoutBox {
  return box('g', { display: 'grid', width: { kind: 'px', value: width }, grid: g }, items.map((b) => ({ ...b, style: { ...b.style, gridItem: b.style.gridItem ?? autoItem } })));
}


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
  it('checks a replaced child of a grid container like a box child, and refuses a replaced grid container', () => {
    const leaf = (style: Record<string, unknown>): unknown => ({ kind: 'replaced', id: 'i', style: { ...box('x', {}).style, ...style }, natural: { kind: 'image', width: 10, height: 10 }, defaultWidth: 300, defaultHeight: 150, objectFit: 'fill', objectPositionX: { kind: 'px', value: 0 }, objectPositionY: { kind: 'px', value: 0 } });
    const withLeaf = (style: Record<string, unknown>): unknown => mutate((r) => {
      (r.children[0] as unknown as { children: unknown[] }).children = [leaf(style)];
    });
    expect(codes(withLeaf({ gridItem: autoItem }))).toEqual([]);
    expect(codes(withLeaf({}))).toContain('grid-shape $.root.children[0].children[0].style.gridItem');
    const placedOutside = input(box('root', {}, []));
    (placedOutside.root as unknown as { children: unknown[] }).children = [leaf({ gridItem: autoItem })];
    expect(codes(placedOutside)).toContain('grid-shape $.root.children[0].style.gridItem');
    const replacedGrid = input(box('root', {}, []));
    (replacedGrid.root as unknown as { children: unknown[] }).children = [leaf({ display: 'grid', grid: gridStyle({}) })];
    expect(codes(replacedGrid)).toContain('grid-shape $.root.children[0].style.grid');
  });
  it('takes an inline box only inside an anonymous grid item, never as a grid item or a grid container (INL1a with GRID G1a)', () => {
    // css-grid-2 §6: inline content in a grid container is wrapped in an anonymous, auto-placed grid item.
    const wrapped = input(box('root', {}, [grid(gridStyle({}), [anon('g:anon0', { gridItem: autoItem }, [text('g:text0', 'X'), span('s', [text('s:text0', 'Y')])])])]));
    expect(codes(wrapped)).toEqual([]);
    const bare = input(box('root', {}, [grid(gridStyle({}), [])]));
    (bare.root.children[0] as unknown as { children: unknown[] }).children = [span('s', [text('s:text0', 'Y')])];
    expect(codes(bare)).toContain('text-in-flex $.root.children[0].children');
    // css-display-3 §2.7: a grid item is blockified, so an inline box never carries a placement or a grid style.
    for (const over of [{ gridItem: autoItem }, { grid: gridStyle({}) }]) {
      const placed = input(box('root', {}, [box('p', {}, [span('s', [text('s:text0', 'Y')])])]));
      const s0 = ((placed.root.children[0] as unknown as { children: { style: Record<string, unknown> }[] }).children[0] as { style: Record<string, unknown> });
      Object.assign(s0.style, over);
      expect(codes(placed), JSON.stringify(Object.keys(over))).toContain('grid-shape $.root.children[0].children[0].style.grid');
    }
  });
  it('judges an anonymous item by its values, not by the order of its keys', () => {
    const reordered = input(box('root', {}, [grid(gridStyle({}), [anon('g:anon0', {}, [text('g:text0', 'X')])])]));
    const a = (reordered.root.children[0] as unknown as { children: { style: Record<string, unknown> }[] }).children[0] as { style: Record<string, unknown> };
    a.style['gridItem'] = { justifySelf: 'auto', row: { span: 1, kind: 'auto' }, column: { span: 1, kind: 'auto' } };
    a.style['marginTop'] = { value: 0, kind: 'px' };
    expect(codes(reordered)).toEqual([]);
    a.style['marginTop'] = { value: 1, kind: 'px' };
    expect(codes(reordered)).toContain('anonymous-shape $.root.children[0].children[0]');
  });
});

describe('display: grid before the grid engine', () => {
  it('is refused with a typed unsupported result, never laid out as a block', () => {
    const r = layout(input(box('root', {}, [grid(gridStyle({ templateColumns: [{ count: 1, sizes: [fr(1)] }], explicitColumnCount: 1 }), [box('a', {})])])), ahemMeasurer);
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('grid-layout');
  });
});
