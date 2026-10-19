// GRID G1a and G2 engine checks beside the G-P differential test (packages/parity/test/grid-corpus-*.test.ts): the grid arithmetic
// helpers, the validator's grid shape rules with a planted input for each, and small engine cases pinned to Chrome 145 corpus values.
import { describe, expect, it } from 'vitest';
import type { GridAutoRepeat, GridContainerStyle, GridItemStyle, GridLine, LayoutBox, LayoutInput, TrackSize } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, layout, validateLayoutInput } from '../src/index.ts';
import type { LU } from '../src/units.ts';
import { ceilToInt, divLu, equalShare, floorToInt, frLeftover, frShareToLu, intDiv, intMod, rawOverFloat, setFlexFactor } from '../src/units.ts';
import { ahemFont, anon, box, neutralEnvironment, span, text } from './helpers.ts';

const fr = (value: number): TrackSize => ({ kind: 'breadth', breadth: { kind: 'fr', value } });
const px = (value: number): TrackSize => ({ kind: 'breadth', breadth: { kind: 'px', value } });
const AUTO: TrackSize = { kind: 'breadth', breadth: { kind: 'auto' } };

function gridStyle(over: Partial<GridContainerStyle>): GridContainerStyle {
  return { templateColumns: [], templateRows: [], autoColumns: [AUTO], autoRows: [AUTO], explicitColumnCount: 0, explicitRowCount: 0, autoRepeatColumns: null, autoRepeatRows: null, autoFlow: 'row', dense: false, justifyItems: 'normal', ...over };
}

const autoItem: GridItemStyle = { column: { kind: 'auto', span: 1 }, row: { kind: 'auto', span: 1 }, justifySelf: 'auto' };

function input(root: LayoutBox): LayoutInput {
  const viewport = { width: 400, height: 300 };
  return { viewport, devicePixelRatio: 1, ...neutralEnvironment(viewport), root };
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

  it('LayoutUnit division truncates its fixed-point quotient, and FloorToInt and CeilToInt round it as Blink does (G2)', () => {
    // 100px / 33.296875px is 3.003px, which truncates to exactly 3px: both roundings give 3 repetitions.
    expect(divLu(6400 as LU, 2131 as LU)).toBe(192);
    expect(floorToInt(divLu(6400 as LU, 2131 as LU))).toBe(3);
    expect(ceilToInt(divLu(6400 as LU, 2131 as LU))).toBe(3);
    expect([floorToInt(213 as LU), ceilToInt(213 as LU)]).toEqual([3, 4]);
    expect([floorToInt(-1 as LU), ceilToInt(-1 as LU) + 0]).toEqual([-1, 0]);
    expect(ceilToInt(2147483647 as LU)).toBe(33554431);
    expect(floorToInt(-2147483648 as LU)).toBe(-33554432);
    expect(divLu(2147483647 as LU, 1 as LU)).toBe(2147483647);
    expect(() => divLu(64 as LU, 0 as LU)).toThrow(/division by zero/);
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
  it('rejects an automatic repeater beside a track that is not a fixed size, past the template, or with names out of order, and lines it cannot resolve (G2)', () => {
    const g = (over: Partial<GridContainerStyle>, item: GridItemStyle = autoItem): unknown => input(box('root', {}, [grid(gridStyle(over), [box('a', { gridItem: item })])]));
    const fill = (over: Partial<GridAutoRepeat>): GridAutoRepeat => ({ type: 'auto-fill', index: 0, sizes: [px(10)], lineNames: [{ explicit: [], repeat: [], implicit: [] }], ...over });
    const lines = (start: GridLine, end: GridLine): GridItemStyle => ({ ...autoItem, column: { kind: 'lines', start, end } });
    expect(codes(g({ autoRepeatColumns: fill({}) }, lines({ kind: 'line', n: 2 }, { kind: 'auto' })))).toEqual([]);
    expect(codes(g({ autoRepeatColumns: fill({ sizes: [AUTO] }) }))).toContain('grid-shape $.root.children[0].style.grid.autoRepeatColumns');
    expect(codes(g({ autoRepeatColumns: fill({}), templateColumns: [{ count: 1, sizes: [AUTO] }], explicitColumnCount: 1 }))).toContain('grid-shape $.root.children[0].style.grid.autoRepeatColumns');
    expect(codes(g({ autoRepeatColumns: fill({ index: 1 }) }))).toContain('grid-shape $.root.children[0].style.grid.autoRepeatColumns');
    expect(codes(g({ autoRepeatColumns: fill({ lineNames: [{ explicit: [3, 1], repeat: [], implicit: [] }] }) }))).toContain('grid-shape $.root.children[0].style.grid.autoRepeatColumns.lineNames[0]');
    expect(codes(g({ autoRepeatColumns: fill({ lineNames: [{ explicit: [], repeat: [2], implicit: [] }] }) }))).toContain('grid-shape $.root.children[0].style.grid.autoRepeatColumns.lineNames[0]');
    expect(codes(g({}, lines({ kind: 'line', n: 2 }, { kind: 'auto' })))).toContain('grid-shape $.root.children[0].children[0].style.gridItem.column');
    expect(codes(g({ autoRepeatColumns: fill({}) }, lines({ kind: 'named-line', n: 1, name: 1 }, { kind: 'auto' })))).toContain('grid-shape $.root.children[0].children[0].style.gridItem.column.start');
    expect(codes(g({ autoRepeatColumns: fill({}) }, lines({ kind: 'line', n: 0 }, { kind: 'auto' })))).toContain('grid-shape $.root.children[0].children[0].style.gridItem.column.start');
  });
  it('rejects text directly in a grid container and an anonymous item that is not auto-placed', () => {
    const textIn = input(box('root', {}, [grid(gridStyle({}), [])]));
    (textIn.root.children[0] as unknown as { children: unknown[] }).children = [{ kind: 'text', id: 't', text: 'X', font: { family: 'Ahem', size: 10 }, lineHeight: { kind: 'normal' }, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap', letterSpacing: { kind: 'px', value: 0 }, wordSpacing: { kind: 'px', value: 0 }, overflowWrap: 'normal', wordBreak: 'normal' }];
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
  it('places an absolutely positioned child like an in-flow one, and takes a single line only on it (css-grid-2 §9.1)', () => {
    const abs = (gi: GridItemStyle | null): unknown => {
      const v = input(box('root', {}, [grid(gridStyle({}), [box('a', {})])]));
      const a = (v.root.children[0] as unknown as { children: { style: Record<string, unknown> }[] }).children[0] as { style: Record<string, unknown> };
      a.style['position'] = 'absolute';
      a.style['gridItem'] = gi;
      return v;
    };
    expect(codes(abs({ ...autoItem, column: { kind: 'start-line', line: 1 }, row: { kind: 'end-line', line: -2 } }))).toEqual([]);
    expect(codes(abs(null))).toContain('grid-shape $.root.children[0].children[0].style.gridItem');
    expect(codes(abs({ ...autoItem, column: { kind: 'start-line', line: 10000000 } }))).toContain('grid-shape $.root.children[0].children[0].style.gridItem.column');
    expect(codes(abs({ ...autoItem, row: { kind: 'end-line', line: -10000000 } }))).toContain('grid-shape $.root.children[0].children[0].style.gridItem.row');
    const inFlow = mutate((r) => {
      (r.children[0]?.children[0] as { style: Record<string, unknown> }).style['gridItem'] = { ...autoItem, column: { kind: 'start-line', line: 0 } };
    });
    expect(codes(inFlow)).toContain('grid-shape $.root.children[0].children[0].style.gridItem.column');
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

/** Each box's [x, y, width, height] relative to the grid box g. */
function inGrid(root: LayoutBox, ids: readonly string[]): (number[] | null)[] {
  const m = boxesOf(root);
  const g = m.get('g');
  if (g === undefined) throw new Error('no grid box');
  return ids.map((id) => {
    const b = m.get(id);
    return b === undefined ? null : [b.x - g.x, b.y - g.y, b.width, b.height];
  });
}

const fillOf = (type: 'auto-fill' | 'auto-fit', sizes: readonly TrackSize[], index = 0): GridAutoRepeat => ({ type, index, sizes, lineNames: [{ explicit: [], repeat: [], implicit: [] }] });
const h10 = (id: string, gridItem: GridItemStyle = autoItem): LayoutBox => box(id, { height: { kind: 'px', value: 10 }, gridItem });
const at = (start: GridLine, end: GridLine): GridItemStyle => ({ ...autoItem, column: { kind: 'lines', start, end } });

describe('automatic repetitions (GRID G2, Blink CalculateAutomaticRepetitions and GridRangeBuilder), corpus cases at DPR 1 ltr', () => {
  it('r-fill-fixed and r-fill-minmax: a definite width fits floor((width + gap) / (track + gap)) repetitions', () => {
    const fixed = box('g', { display: 'grid', width: { kind: 'px', value: 100 }, columnGap: { kind: 'px', value: 5 }, grid: gridStyle({ autoRepeatColumns: fillOf('auto-fill', [px(30)]) }) }, ['i0', 'i1', 'i2', 'i3'].map((id) => h10(id)));
    // floor(105 / 35) = 3 columns, so i3 wraps to the second row.
    expect(inGrid(fixed, ['i0', 'i1', 'i3'])).toEqual([[0, 0, 1920, 640], [2240, 0, 1920, 640], [0, 640, 1920, 640]]);
    const minmax = grid(gridStyle({ autoRepeatColumns: fillOf('auto-fill', [{ kind: 'minmax', min: { kind: 'px', value: 30 }, max: { kind: 'fr', value: 1 } }]) }), ['i0', 'i1', 'i2', 'i3'].map((id) => h10(id)));
    expect(inGrid(minmax, ['i0', 'i1', 'i2', 'i3'])).toEqual([[0, 0, 2133, 640], [2133, 0, 2133, 640], [4266, 0, 2133, 640], [0, 640, 2133, 640]]);
  });
  it('repeats at least once when one repetition does not fit, and floors a zero track at 1px for the count only (r-fill-zero)', () => {
    expect(inGrid(grid(gridStyle({ autoRepeatColumns: fillOf('auto-fill', [px(30)]) }), [h10('i0'), h10('i1')], 10), ['i0', 'i1'])).toEqual([[0, 0, 1920, 640], [0, 640, 1920, 640]]);
    // Ten 0px columns in 10px: the eleventh item wraps to the second row.
    const items = Array.from({ length: 11 }, (_, k) => h10(`i${k}`));
    expect(inGrid(grid(gridStyle({ autoRepeatColumns: fillOf('auto-fill', [px(0)]) }), items, 10), ['i0', 'i9', 'i10'])).toEqual([[0, 0, 0, 640], [0, 0, 0, 640], [0, 640, 0, 640]]);
  });
  it('counts the fixed tracks around the repeater (r-fill-mixed: 10px repeat(auto-fill, 20px 7px) 15px over 100px)', () => {
    const g = gridStyle({ templateColumns: [{ count: 1, sizes: [px(10)] }, { count: 1, sizes: [px(15)] }], explicitColumnCount: 2, autoRepeatColumns: fillOf('auto-fill', [px(20), px(7)], 1) });
    expect(inGrid(grid(g, ['i0', 'i1', 'i2'].map((id) => h10(id))), ['i0', 'i1', 'i2'])).toEqual([[0, 0, 640, 640], [640, 0, 1280, 640], [1920, 0, 448, 640]]);
  });
  it('resolves a percentage track against the width (r-fill-pct: repeat(auto-fill, 23%) over 100px is four 23px columns)', () => {
    const g = gridStyle({ autoRepeatColumns: fillOf('auto-fill', [{ kind: 'breadth', breadth: { kind: 'percent', value: 23 } }]) });
    expect(inGrid(grid(g, ['i0', 'i1', 'i2', 'i3', 'i4'].map((id) => h10(id))), ['i3', 'i4'])).toEqual([[4416, 0, 1472, 640], [0, 640, 1472, 640]]);
  });
  it('rounds up to fill a minimum height and down to stay under a maximum height when the height is indefinite', () => {
    const rows = (limit: Record<string, unknown>): LayoutBox => box('g', { display: 'grid', width: { kind: 'px', value: 100 }, ...limit, grid: gridStyle({ autoFlow: 'column', autoColumns: [px(10)], autoRepeatRows: fillOf('auto-fill', [px(20)]) }) }, ['i0', 'i1', 'i2'].map((id) => box(id, { gridItem: autoItem })));
    // min-height 50px: ceil(50 / 20) = 3 rows, so i2 stays in the first column; max-height 50px: floor(50 / 20) = 2 rows.
    expect(inGrid(rows({ minHeight: { kind: 'px', value: 50 } }), ['g', 'i2'])).toEqual([[0, 0, 6400, 3840], [0, 2560, 640, 1280]]);
    expect(inGrid(rows({ maxHeight: { kind: 'px', value: 50 } }), ['g', 'i2'])).toEqual([[0, 0, 6400, 2560], [640, 0, 640, 1280]]);
  });
  it('collapses the empty tracks of repeat(auto-fit) and their gaps (r-fit-center, g-auto-fit-collapse)', () => {
    const fit = (track: number, gap: number): LayoutBox => box('g', { display: 'grid', width: { kind: 'px', value: 200 }, columnGap: { kind: 'px', value: gap }, justifyContent: 'center', grid: gridStyle({ autoRepeatColumns: fillOf('auto-fit', [px(track)]) }) }, [h10('i0'), h10('i1')]);
    expect(inGrid(fit(30, 4), ['i0', 'i1'])).toEqual([[4352, 0, 1920, 640], [6528, 0, 1920, 640]]);
    expect(inGrid(fit(20, 10), ['i0', 'i1'])).toEqual([[4800, 0, 1280, 640], [6720, 0, 1280, 640]]);
  });
  it('collapses empty auto-fit tracks between placed items, so a later item moves back over them', () => {
    // Six 30px columns with 4px gaps; i1 at line 4 follows i0 directly, since columns 2 and 3 and their gaps collapse.
    const make = (type: 'auto-fill' | 'auto-fit'): LayoutBox => box('g', { display: 'grid', width: { kind: 'px', value: 200 }, columnGap: { kind: 'px', value: 4 }, grid: gridStyle({ autoRepeatColumns: fillOf(type, [px(30)]) }) }, [h10('i0'), h10('i1', at({ kind: 'line', n: 4 }, { kind: 'auto' }))]);
    expect(inGrid(make('auto-fit'), ['i0', 'i1'])).toEqual([[0, 0, 1920, 640], [2176, 0, 1920, 640]]);
    expect(inGrid(make('auto-fill'), ['i1'])).toEqual([[6528, 0, 1920, 640]]);
  });
  it('gives the space of collapsed auto-fit tracks to the flexible ones (r-fit-fr: minmax(20px, 1fr) over 100.3px)', () => {
    const g = box('g', { display: 'grid', width: { kind: 'px', value: 100.3 }, grid: gridStyle({ autoRepeatColumns: fillOf('auto-fit', [{ kind: 'minmax', min: { kind: 'px', value: 20 }, max: { kind: 'fr', value: 1 } }]) }) }, [h10('i0'), h10('i1')]);
    expect(inGrid(g, ['i0', 'i1'])).toEqual([[0, 0, 3209, 640], [3209, 0, 3210, 640]]);
  });
  it('resolves named lines in and around the repeater as GridNamedLineCollection does (r-fill-named)', () => {
    // repeat(auto-fill, [a] 25px [b]) over 100px: four columns, a on lines 0-3, b on lines 1-4.
    const named: GridAutoRepeat = { type: 'auto-fill', index: 0, sizes: [px(25)], lineNames: [{ explicit: [], repeat: [], implicit: [] }, { explicit: [], repeat: [0], implicit: [] }, { explicit: [], repeat: [1], implicit: [] }] };
    const items = [h10('i0', at({ kind: 'named-line', n: 3, name: 1 }, { kind: 'named-line', n: 3, name: 2 })), h10('i1', at({ kind: 'named-line', n: 1, name: 2 }, { kind: 'span', n: 1 }))];
    expect(inGrid(grid(gridStyle({ autoRepeatColumns: named }), items), ['i0', 'i1'])).toEqual([[3200, 0, 1600, 640], [1600, 640, 1600, 640]]);
    // [s] 10px repeat(auto-fill, 20px) [e] 15px over 100px: three repetitions, so e is line 4 and the line -1 is line 5.
    const around: GridAutoRepeat = { type: 'auto-fill', index: 1, sizes: [px(20)], lineNames: [{ explicit: [], repeat: [], implicit: [] }, { explicit: [2], repeat: [], implicit: [] }, { explicit: [0], repeat: [], implicit: [] }] };
    const g = gridStyle({ templateColumns: [{ count: 1, sizes: [px(10)] }, { count: 1, sizes: [px(15)] }], explicitColumnCount: 2, autoRepeatColumns: around });
    const placed = [h10('e', at({ kind: 'named-line', n: 1, name: 1 }, { kind: 'line', n: -1 })), h10('s', at({ kind: 'area', implicitName: 0, name: 2 }, { kind: 'named-span', n: 1, name: 1 }))];
    expect(inGrid(grid(g, placed), ['e', 's'])).toEqual([[4480, 0, 960, 640], [0, 640, 4480, 640]]);
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
  const inset0 = { top: { kind: 'px', value: 0 }, right: { kind: 'px', value: 0 }, bottom: { kind: 'px', value: 0 }, left: { kind: 'px', value: 0 } } as const;
  const absItem = (id: string, column: GridItemStyle['column'], over: Parameters<typeof box>[1] = inset0): LayoutBox => box(id, { position: 'absolute', ...over, gridItem: { ...autoItem, column } });
  it('ab-mid-range: an abspos line inside a set of three 1fr tracks takes the remainder unit first (GR17: 2134, not 2133)', () => {
    const g = grid(gridStyle({ templateColumns: [{ count: 3, sizes: [fr(1)] }], explicitColumnCount: 3 }), [absItem('i0', { kind: 'definite', start: 1, end: 2 }), absItem('i1', { kind: 'definite', start: 2, end: 3 })]);
    const m = boxesOf({ ...g, style: { ...g.style, position: 'relative', height: { kind: 'px', value: 20 } } });
    expect(['i0', 'i1'].map((id) => [m.get(id)?.x, m.get(id)?.width])).toEqual([[2134, 2133], [4267, 2133]]);
  });
  it('ab-auto-lines: an auto line, and a line beyond the grid, is the padding edge', () => {
    const g = grid(gridStyle({ templateColumns: [{ count: 2, sizes: [px(30)] }], explicitColumnCount: 2 }), [box('i', { height: { kind: 'px', value: 10 } }), absItem('a', { kind: 'start-line', line: 1 }), absItem('b', { kind: 'definite', start: -8, end: 1 })], 200);
    const m = boxesOf({ ...g, style: { ...g.style, position: 'relative', paddingLeft: { kind: 'px', value: 4 }, paddingRight: { kind: 'px', value: 6 } } });
    // Columns start at the 4px padding: line 1 is at 34px; the padding box runs from 0 to 210px.
    expect([m.get('a')?.x, m.get('a')?.width, m.get('b')?.x, m.get('b')?.width]).toEqual([2176, 11264, 0, 2176]);
  });
  it('a static grid is no containing block: the static position aligns in its content box by justify-self and align-self', () => {
    const g = grid(gridStyle({ justifyItems: 'center' }), [box('a', { position: 'absolute', width: { kind: 'px', value: 10 }, height: { kind: 'px', value: 4 }, alignSelf: 'end', gridItem: { ...autoItem, column: { kind: 'definite', start: 1, end: 2 } } })], 100);
    const m = boxesOf({ ...g, style: { ...g.style, height: { kind: 'px', value: 20 }, paddingLeft: { kind: 'px', value: 2 } } });
    expect([m.get('a')?.x, m.get('a')?.y]).toEqual([(2 + 45) * 64, 16 * 64]);
  });
  it('refuses self-alignment between two insets, which position.ts does not do (css-position-3 §4.4)', () => {
    const g = grid(gridStyle({}), [absItem('a', { kind: 'auto', span: 1 }, { ...inset0, width: { kind: 'px', value: 10 }, alignSelf: 'center' })]);
    const r = layout(input(box('root', {}, [{ ...g, style: { ...g.style, position: 'relative' } }])), ahemMeasurer);
    expect(r.kind === 'unsupported' ? `${r.unsupported.code} ${r.unsupported.nodeId}` : 'ok').toBe('abspos-self-alignment a');
  });
  it('resolves an abspos child\'s lines in an automatic repeater with the grid\'s own resolver, then drops its auto sides (G2 with G4)', () => {
    // repeat(auto-fill, [a] 25px [b]) over 100px: four columns, a on lines 0-3 and b on lines 1-4 (Blink ResolveOutOfFlowItemGridLines).
    const named: GridAutoRepeat = { type: 'auto-fill', index: 0, sizes: [px(25)], lineNames: [{ explicit: [], repeat: [], implicit: [] }, { explicit: [], repeat: [0], implicit: [] }, { explicit: [], repeat: [1], implicit: [] }] };
    const kids = [
      absItem('a', at({ kind: 'named-line', n: 2, name: 1 }, { kind: 'named-line', n: 3, name: 2 }).column),
      absItem('b', at({ kind: 'auto' }, { kind: 'line', n: -2 }).column),
      absItem('c', at({ kind: 'line', n: 2 }, { kind: 'auto' }).column),
      absItem('d', at({ kind: 'span', n: 2 }, { kind: 'auto' }).column),
    ];
    const g = box('g', { display: 'grid', position: 'relative', width: { kind: 'px', value: 100 }, height: { kind: 'px', value: 20 }, grid: gridStyle({ autoRepeatColumns: named }) }, kids);
    // a: lines 1 to 3; b: the padding edge to line 3; c: line 1 to the padding edge; d: span 2 / auto has no definite line.
    expect(inGrid(g, ['a', 'b', 'c', 'd']).map((r) => (r === null ? null : [r[0], r[2]]))).toEqual([[1600, 3200], [0, 4800], [1600, 4800], [0, 6400]]);
    // With repeat(auto-fit) and one in-flow item, columns 2-4 collapse: line 1 is past the first gap and the last line snaps back over it.
    const fit = (type: 'auto-fill' | 'auto-fit'): LayoutBox => box('g', { display: 'grid', position: 'relative', width: { kind: 'px', value: 200 }, columnGap: { kind: 'px', value: 4 }, grid: gridStyle({ autoRepeatColumns: fillOf(type, [px(30)]) }) }, [h10('i0'), absItem('e', at({ kind: 'line', n: 2 }, { kind: 'auto' }).column), absItem('f', at({ kind: 'line', n: -1 }, { kind: 'auto' }).column)]);
    expect(inGrid(fit('auto-fit'), ['e', 'f']).map((r) => (r === null ? null : [r[0], r[2]]))).toEqual([[2176, 10624], [1920, 10880]]);
    expect(inGrid(fit('auto-fill'), ['e', 'f']).map((r) => (r === null ? null : [r[0], r[2]]))).toEqual([[2176, 10624], [12800, 0]]);
  });
  it('p-dense: dense packing fills the hole before an earlier item', () => {
    const colSpan = (n: number): GridItemStyle => ({ ...autoItem, column: { kind: 'auto', span: n } });
    const items = [colSpan(3), colSpan(2), autoItem, autoItem, colSpan(3)].map((gi, k) => box(`i${k}`, { height: { kind: 'px', value: 5 }, gridItem: gi }));
    const m = boxesOf(grid(gridStyle({ templateColumns: [{ count: 4, sizes: [px(20)] }], explicitColumnCount: 4, autoRows: [px(10)], dense: true }), items));
    const g = m.get('g');
    if (g === undefined) throw new Error('no grid box');
    // Four 20px (1280 LU) columns, 10px (640 LU) rows: i1 wraps to row 2, dense packing puts i2 and i3 in the holes before it.
    expect(['i0', 'i1', 'i2', 'i3', 'i4'].map((id) => {
      const b = m.get(id);
      return b === undefined ? null : [b.x - g.x, b.y - g.y, b.width, b.height];
    })).toEqual([[0, 0, 3840, 320], [0, 640, 2560, 320], [3840, 0, 1280, 320], [2560, 640, 1280, 320], [0, 1280, 3840, 320]]);
  });
});

describe('first baseline self-alignment in the block axis (GRID G3, Blink ComputeGridItemBaselines and the baseline shim)', () => {
  const two: GridContainerStyle = gridStyle({ templateColumns: [{ count: 2, sizes: [AUTO] }], explicitColumnCount: 2 });
  /** An item holding one Ahem X: its line box is the font size, its baseline 0.8 of it below the content top. */
  const glyph = (id: string, size: number, over: Parameters<typeof box>[1] = {}): LayoutBox => box(id, over, [text(`${id}:t`, 'X', { font: ahemFont(size) })]);
  const yh = (m: ReturnType<typeof boxesOf>, ids: readonly string[]): number[][] => {
    const g = m.get('g');
    if (g === undefined) throw new Error('no grid box');
    return ids.map((id) => {
      const b = m.get(id);
      if (b === undefined) throw new Error(`no box ${id}`);
      return [b.y - g.y, b.height];
    });
  };

  it('aligns the baselines of a row and grows the auto row by the shim (b-row-shim: 20px with 7px padding below, 10px with 15px above)', () => {
    const items = [glyph('a', 20, { paddingBottom: { kind: 'px', value: 7 } }), glyph('b', 10, { paddingTop: { kind: 'px', value: 15 } })];
    const g = box('g', { display: 'grid', width: { kind: 'px', value: 100 }, alignItems: 'baseline', grid: two }, items.map((b) => ({ ...b, style: { ...b.style, gridItem: autoItem } })));
    const m = boxesOf(g);
    // Track baseline 23px (15 + 8): a moves down 7px, and its 27px plus the 7px shim make the row 34px.
    expect(yh(m, ['a', 'b'])).toEqual([[448, 1728], [0, 1600]]);
    expect(m.get('g')?.height).toBe(2176);
  });

  it('counts the block-start margin in the track baseline and places the item by the baseline offset alone (AlignmentOffset)', () => {
    const items = [glyph('a', 10, { marginTop: { kind: 'px', value: 3 }, alignSelf: 'baseline' }), glyph('b', 20, { alignSelf: 'baseline' })];
    // a's margin-box baseline is 3 + 8 = 11px, b's 16px: a's border box starts 16 - 8 = 8px down; the row is b's 20px.
    const m = boxesOf(grid(two, items));
    expect(yh(m, ['a', 'b'])).toEqual([[512, 640], [0, 1280]]);
    expect(m.get('g')?.height).toBe(1280);
  });

  it('synthesizes the baseline of an item with none at its border-box bottom (b-synthesized)', () => {
    const items = [box('a', { alignSelf: 'baseline', height: { kind: 'px', value: 30 } }), glyph('b', 10, { alignSelf: 'baseline' })];
    expect(yh(boxesOf(grid(two, items)), ['a', 'b'])).toEqual([[0, 1920], [1408, 640]]);
  });

  it('falls back to start for an item with no baseline whose percentage height depends on its auto row (SetAlignmentFallback)', () => {
    const items = [box('a', { alignSelf: 'baseline', height: { kind: 'percent', value: 50 } }), glyph('b', 20, { alignSelf: 'baseline' })];
    // a takes no part: no shim grows the row past b's 20px, and a sits at the row start with half of it.
    expect(yh(boxesOf(grid(two, items)), ['a', 'b'])).toEqual([[0, 640], [0, 1280]]);
    // In a fixed row a's height does not depend on the row's sizing, so it aligns by its synthesized baseline (25px).
    const fixed = gridStyle({ templateColumns: [{ count: 2, sizes: [AUTO] }], explicitColumnCount: 2, templateRows: [{ count: 1, sizes: [px(50)] }], explicitRowCount: 1 });
    expect(yh(boxesOf(grid(fixed, items)), ['a', 'b'])).toEqual([[0, 1600], [576, 1280]]);
  });

  it('an item spanning two rows joins the baseline group of its first row', () => {
    const items = [
      glyph('a', 20, { alignSelf: 'baseline', gridItem: { ...autoItem, row: { kind: 'auto', span: 2 } } }),
      glyph('b', 10, { alignSelf: 'baseline' }),
      glyph('c', 10, { alignSelf: 'baseline', gridItem: { ...autoItem, column: { kind: 'definite', start: 1, end: 2 }, row: { kind: 'definite', start: 1, end: 2 } } }),
    ];
    // Row 1 shares a's 16px baseline with b, which the 8px shim makes 18px; c is alone in the 10px row 2.
    expect(yh(boxesOf(grid(two, items)), ['a', 'b', 'c'])).toEqual([[0, 1280], [512, 640], [1152, 640]]);
  });

  it('auto margins win over baseline alignment in the block axis', () => {
    const items = [glyph('a', 10, { alignSelf: 'baseline', marginTop: { kind: 'auto' } }), glyph('b', 20, { alignSelf: 'baseline' })];
    // a is end-aligned by its auto margin, not lowered to b's baseline.
    expect(yh(boxesOf(grid(two, items)), ['a', 'b'])).toEqual([[640, 640], [0, 1280]]);
  });

  it("gives the grid the first row set's major baseline as its first baseline, ahead of the first item in row-major order", () => {
    const items = [glyph('a', 10, { alignSelf: 'start', paddingTop: { kind: 'px', value: 30 } }), glyph('b', 20, { alignSelf: 'baseline' })];
    const row = box('f', { display: 'flex', alignItems: 'baseline', width: { kind: 'px', value: 300 } }, [grid(two, items), glyph('x', 10)]);
    const r = layout(input(box('root', {}, [row])), ahemMeasurer);
    if (r.kind !== 'ok') throw new Error(r.unsupported.code);
    const abs = absoluteRects(r.boxes);
    // The grid's baseline is b's 16px, not a's 38px: x (baseline 8px) sits 8px down.
    expect((abs.get('x')?.y ?? 0) - (abs.get('f')?.y ?? 0)).toBe(512);
  });
});

describe('baseline self-alignment in the inline axis and last baseline alignment (GRID G3b)', () => {
  const glyph = (id: string, size: number, over: Parameters<typeof box>[1] = {}, content = 'X'): LayoutBox => box(id, over, [text(`${id}:t`, content, { font: ahemFont(size) })]);
  const rects = (m: ReturnType<typeof boxesOf>, ids: readonly string[]): number[][] => {
    const g = m.get('g');
    if (g === undefined) throw new Error('no grid box');
    return ids.map((id) => {
      const b = m.get(id);
      if (b === undefined) throw new Error(`no box ${id}`);
      return [b.x - g.x, b.y - g.y, b.width, b.height];
    });
  };
  const column60 = gridStyle({ templateColumns: [{ count: 1, sizes: [px(60)] }], explicitColumnCount: 1 });
  const items = (justifySelf: 'baseline' | 'last baseline'): LayoutBox[] => [
    box('a', { width: { kind: 'px', value: 10 }, height: { kind: 'px', value: 5 }, marginLeft: { kind: 'px', value: 3 }, marginRight: { kind: 'px', value: 3 }, gridItem: { ...autoItem, justifySelf } }),
    box('b', { width: { kind: 'px', value: 20 }, height: { kind: 'px', value: 5 }, gridItem: { ...autoItem, justifySelf } }),
  ];
  const rtl = (b: LayoutBox): LayoutBox => ({ ...b, style: { ...b.style, direction: 'rtl' } });
  /** justify-content: start, so auto columns keep their sizes. */
  const packed = (b: LayoutBox): LayoutBox => ({ ...b, style: { ...b.style, justifyContent: 'start' } });

  it('synthesizes a horizontal item\'s inline-axis baseline at its left edge: start margins share it in ltr, left edges in rtl', () => {
    // ltr: the column baseline is the larger start margin, 3px; rtl: the larger inline-start margin plus width, 13px and 20px.
    expect(rects(boxesOf(grid(column60, items('baseline'))), ['a', 'b'])).toEqual([[192, 0, 640, 320], [192, 320, 1280, 320]]);
    expect(rects(boxesOf(rtl(grid(column60, items('baseline')))), ['a', 'b'])).toEqual([[5120, 0, 640, 320], [5120, 320, 1280, 320]]);
  });

  it('last baseline in the inline axis: the end margin plus the width from the column end in ltr, the end margin in rtl', () => {
    // ltr: the minor baseline is max(3 + 10, 0 + 20) = 20px from the column end; rtl: max(3, 0) = 3px from the column's left end.
    expect(rects(boxesOf(grid(column60, items('last baseline'))), ['a', 'b'])).toEqual([[2560, 0, 640, 320], [2560, 320, 1280, 320]]);
    expect(rects(boxesOf(rtl(grid(column60, items('last baseline')))), ['a', 'b'])).toEqual([[2752, 0, 640, 320], [2752, 320, 1280, 320]]);
  });

  it('measures the column baseline of an item in an auto column at its min-content width, so in rtl its shim cuts its max-content contribution to that', () => {
    const auto = gridStyle({ templateColumns: [{ count: 1, sizes: [AUTO] }], explicitColumnCount: 1 });
    const it1 = [glyph('a', 10, { gridItem: { ...autoItem, justifySelf: 'baseline' } }, 'X X')];
    // ltr: the baseline is the left edge, which no width moves: the column is the 30px max-content width.
    expect(rects(boxesOf(packed(grid(auto, it1))), ['a'])).toEqual([[0, 0, 1920, 640]]);
    // rtl: the track baseline is the 10px min-content width, and each contribution plus its shim is that 10px.
    expect(rects(boxesOf(rtl(packed(grid(auto, it1)))), ['a'])).toEqual([[5760, 0, 640, 1280]]);
  });

  it('last baseline in the block axis aligns last lines in the minor group, measured from the row end, and grows the row by the shim', () => {
    const three = gridStyle({ templateColumns: [{ count: 3, sizes: [px(30)] }], explicitColumnCount: 3 });
    const g = box('g', { display: 'grid', width: { kind: 'px', value: 100 }, alignItems: 'last baseline', grid: three }, [glyph('a', 10, { gridItem: autoItem }, 'XX XX XX'), glyph('b', 20, { gridItem: autoItem })]);
    // a's last baseline is 2px above its bottom, b's 4px: a's 2px shim makes the row 32px, and b ends at the row end.
    const m = boxesOf(g);
    expect(rects(m, ['a', 'b'])).toEqual([[0, 0, 1920, 1920], [1920, 768, 1920, 1280]]);
    expect(m.get('g')?.height).toBe(2048);
    // The grid's first baseline is its first row's minor baseline, 28px down: a 10px glyph beside it in a flex line sits 20px down.
    const f = box('f', { display: 'flex', alignItems: 'baseline', width: { kind: 'px', value: 300 } }, [g, glyph('x', 10)]);
    const r = layout(input(box('root', {}, [f])), ahemMeasurer);
    if (r.kind !== 'ok') throw new Error(r.unsupported.code);
    const abs = absoluteRects(r.boxes);
    expect((abs.get('x')?.y ?? 0) - (abs.get('f')?.y ?? 0)).toBe(1280);
  });

  it('falls back to end alignment for a last-baseline item with no baseline whose percentage height depends on its auto row', () => {
    const two = gridStyle({ templateColumns: [{ count: 2, sizes: [AUTO] }], explicitColumnCount: 2 });
    const items2 = [box('a', { alignSelf: 'last baseline', width: { kind: 'px', value: 10 }, height: { kind: 'percent', value: 50 } }), glyph('b', 20, { alignSelf: 'last baseline' })];
    // a takes no part and sits at the row end with half of b's 20px row.
    expect(rects(boxesOf(packed(grid(two, items2))), ['a', 'b'])).toEqual([[0, 640, 640, 640], [640, 0, 1280, 1280]]);
  });

  it('refuses a last baseline that a flex or grid container with items would give (grid-last-baseline)', () => {
    const one = gridStyle({ templateColumns: [{ count: 1, sizes: [AUTO] }], explicitColumnCount: 1 });
    const codeOf = (item: LayoutBox): string => {
      const r = layout(input(box('root', {}, [grid(one, [item])])), ahemMeasurer);
      return r.kind === 'ok' ? 'ok' : `${r.unsupported.code} ${r.unsupported.nodeId}`;
    };
    expect(codeOf(box('a', { display: 'flex', alignSelf: 'last baseline' }, [glyph('a1', 10)]))).toBe('grid-last-baseline a');
    expect(codeOf(box('a', { alignSelf: 'last baseline' }, [glyph('a1', 10), box('a2', { display: 'flex' }, [glyph('a3', 10)])]))).toBe('grid-last-baseline a');
    expect(codeOf(box('a', { alignSelf: 'last baseline' }, [glyph('a1', 10), box('a2', {}, [box('a3', { display: 'grid', grid: one }, [glyph('a4', 10, { gridItem: autoItem })])])]))).toBe('grid-last-baseline a');
    // Blink stops at a line-clamp container's clamp point, which is not modelled: the clamp container, as the item or its last child.
    const clamp = { overflowX: 'hidden', overflowY: 'hidden', lineClamp: 2 } as const;
    expect(codeOf(box('a', { ...clamp, alignSelf: 'last baseline' }, [glyph('a1', 10)]))).toBe('grid-last-baseline a');
    expect(codeOf(box('a', { alignSelf: 'last baseline' }, [box('a1', clamp, [glyph('a2', 10)])]))).toBe('grid-last-baseline a');
    expect(codeOf(box('a', { alignSelf: 'last baseline' }, [box('a1', clamp, [glyph('a2', 10)]), glyph('a3', 10)]))).toBe('ok');
    // An item that is itself a flex or grid container with no items has no last baseline, which is synthesized.
    expect(codeOf(box('a', { display: 'flex', alignSelf: 'last baseline', height: { kind: 'px', value: 10 } }))).toBe('ok');
    expect(codeOf(box('a', { display: 'grid', grid: one, alignSelf: 'last baseline', height: { kind: 'px', value: 10 } }))).toBe('ok');
    // A flex container earlier in the item does not decide it, and first baseline never asks for it.
    expect(codeOf(box('a', { alignSelf: 'last baseline' }, [box('a1', { display: 'flex' }, [glyph('a2', 10)]), glyph('a3', 10)]))).toBe('ok');
    expect(codeOf(box('a', { display: 'flex', alignSelf: 'baseline' }, [glyph('a1', 10)]))).toBe('ok');
  });

  it('takes a scroll container child\'s own last baseline, and skips a child with none, as Blink\'s default baseline algorithm does', () => {
    const two = gridStyle({ templateColumns: [{ count: 2, sizes: [px(30)] }], explicitColumnCount: 2 });
    const clip = { overflowX: 'hidden', overflowY: 'hidden', height: { kind: 'px', value: 5 } } as const;
    const tall = { height: { kind: 'px', value: 5 } } as const;
    // a's y and height, and b's (a 20px glyph, 4px from its last baseline to its bottom), in a row aligned by last baseline.
    const lastBaseline = (last: LayoutBox): number[][] => {
      const g = grid(two, [box('a', { gridItem: autoItem }, [glyph('a1', 10), last]), glyph('b', 20, { gridItem: autoItem })]);
      return rects(boxesOf({ ...g, style: { ...g.style, alignItems: 'last baseline' } }), ['a', 'b']).map((r) => [r[1] as number, r[3] as number]);
    };
    // An empty scroll container, flex or grid container has no last baseline: a1's stands, 8px down a's 15px, so 7px to its bottom;
    // b gets a 3px shim and the row is 23px, with a at its end.
    for (const last of [box('a2', clip), box('a2', { ...tall, display: 'flex' }), box('a2', { ...tall, display: 'grid', grid: two })]) {
      expect(lastBaseline(last), last.style.display).toEqual([[512, 960], [0, 1280]]);
    }
    // A scroll container with lines gives its last line's baseline kept within its border box (8px down a2, clamped to its 5px), so
    // a's is at its bottom: b's 4px decides, a gets a 4px shim and ends 4px above the 20px row's end.
    expect(lastBaseline(glyph('a2', 10, clip))).toEqual([[64, 960], [0, 1280]]);
  });
});

describe('percentages in a grid item\'s padding and margins while its auto column is measured (Blink ComputePadding, ComputePhysicalMargins)', () => {
  const two = gridStyle({ templateColumns: [{ count: 2, sizes: [AUTO] }], explicitColumnCount: 2 });
  const xx = (id: string, over: Parameters<typeof box>[1]): LayoutBox => box(id, over, [text(`${id}:t`, 'XX')]);
  const start = (items: readonly LayoutBox[]): LayoutBox => {
    const g = grid(two, items, 200);
    return { ...g, style: { ...g.style, justifyContent: 'start' } };
  };
  const calc = (pixels: number, percent: number, range: 'all' | 'non-negative') => ({ kind: 'calc', expr: { kind: 'sum', terms: [{ kind: 'px', value: pixels }, { kind: 'percent', value: percent }] }, range }) as const;
  const columns = (m: ReturnType<typeof boxesOf>): number[] => ['a', 'b'].map((id) => m.get(id)?.x ?? NaN);

  it('resolves a calculated padding against zero for the contribution, so its length part widens the column, then against the area', () => {
    const m = boxesOf(start([xx('a', { paddingLeft: calc(10, 5, 'non-negative') }), xx('b', {})]));
    // a's column is 10px + 20px of text; laid out in it, a's padding is 10px + 5% of 30px.
    expect(columns(m)).toEqual([0, 30 * 64]);
    expect(m.get('a:t')?.x).toBe(11.5 * 64);
  });

  it('resolves a percentage or calculated margin against zero for the contribution, not against LayoutUnit(-1)', () => {
    const m = boxesOf(start([xx('a', { marginLeft: { kind: 'percent', value: 10 } }), xx('b', {})]));
    expect(columns(m)).toEqual([2 * 64, 20 * 64]);
    expect(m.get('a')?.width).toBe(18 * 64);
    const c = boxesOf(start([xx('a', { marginLeft: calc(4, 10, 'all') }), xx('b', {})]));
    // The column is 4px + 20px; laid out in it, a's margin is 4px + 10% of 24px.
    expect(columns(c)).toEqual([Math.trunc(6.4 * 64), 24 * 64]);
  });

  it('resolves the padding of an item with a set min-height against its column area when its auto row is sized', () => {
    // A 5px-tall grid with one 100px column: a's 10% padding is 10px in the row axis too (Blink ComputePadding takes the inline
    // size), so its auto row's minimum is 10px and b starts at 10px; against zero the row would only take the 5px of free space.
    const one = gridStyle({ templateColumns: [{ count: 1, sizes: [px(100)] }], explicitColumnCount: 1 });
    for (const paddingTop of [{ kind: 'percent', value: 10 } as const, calc(0, 10, 'non-negative')]) {
      const g = grid(one, [box('a', { minHeight: { kind: 'px', value: 0 }, paddingTop }), box('b', {})]);
      const m = boxesOf({ ...g, style: { ...g.style, height: { kind: 'px', value: 5 } } });
      expect(m.get('b')?.y, paddingTop.kind).toBe(10 * 64);
    }
  });
});
