// GRID G1a and G2 engine checks beside the G-P differential test (packages/parity/test/grid-corpus-*.test.ts): the grid arithmetic
// helpers, the validator's grid shape rules with a planted input for each, and small engine cases pinned to Chrome 145 corpus values.
import { describe, expect, it } from 'vitest';
import type { GridAutoRepeat, GridContainerStyle, GridItemStyle, GridLine, LayoutBox, LayoutInput, TrackSize } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, layout, validateLayoutInput } from '../src/index.ts';
import type { LU } from '../src/units.ts';
import { ceilToInt, divLu, equalShare, floorToInt, frLeftover, frShareToLu, intDiv, intMod, rawOverFloat, setFlexFactor } from '../src/units.ts';
import { anon, box, neutralEnvironment, span, text } from './helpers.ts';

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
