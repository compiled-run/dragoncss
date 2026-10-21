// css-multicol-1 in the engine (multicol.ts, inline.ts multicolLines): column geometry, balancing and the line moves, ported from
// Blink 145's column_layout_algorithm.cc with the orphans and widows rules of block_layout_algorithm.cc. Each expectation below is
// worked by hand through that code in 10px Ahem (10px lines); Chrome agreement is the parity fixtures' job.
import { describe, expect, it } from 'vitest';
import type { LayoutBox, LayoutResult, LayoutStyle, LU, MulticolStyle } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, fromCssPx, fromRaw, layoutWithFaults, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines, validateLayoutInput } from '../src/index.ts';
import { balanceColumns, columnGeometry, columnOffsets, usedColumnCount } from '../src/multicol.ts';
import { box, neutralEnvironment, pct, px, span, text } from './helpers.ts';

const L = 640;
const ctx = { measurer: ahemMeasurer, devicePixelRatio: 1, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS };
const cols = (count: number, width: MulticolStyle['width'] = { kind: 'auto' }): Partial<LayoutStyle> => ({ multicol: { count, width } });
const lu = (raw: number): LU => fromRaw(raw);

function run(root: LayoutBox): LayoutResult {
  return layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer, NO_ENGINE_FAULTS);
}

function rect(r: LayoutResult, id: string) {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return absoluteRects(r.boxes).get(id);
}

function refusal(r: LayoutResult): string {
  return r.kind === 'unsupported' ? `${r.unsupported.code}: ${r.unsupported.detail}` : 'laid out';
}

describe('column geometry (ColumnLayoutAlgorithm::Layout, ResolveUsedColumnCount, LayoutUnitDiffuser)', () => {
  it('splits the content box less count - 1 gaps, and spreads the stride remainder over the columns', () => {
    // 210px, 3 columns, gap normal (1em of 10px): (13440 - 1280) / 3 = 4053 raw; stride 12160 + 1920 = 14080 = 3 * 4693 + 1.
    const g = columnGeometry({ count: 3, width: { kind: 'auto' } }, { kind: 'normal' }, 10, fromCssPx(210));
    expect(g).toEqual({ count: 3, width: 4053, stride: 14080 });
    // The diffuser adds the remainder's epsilon at the second step (x reaches y = 3), then starts over after count columns.
    expect(columnOffsets(g, 5)).toEqual([0, 4693, 9387, 14080, 18773]);
  });

  it('fits as many column-width columns as the content box holds, at most column-count', () => {
    const at = (count: number, width: number, gap: number) => usedColumnCount({ count, width: px(width) }, fromCssPx(gap), fromCssPx(300));
    expect(at(0, 90, 10)).toBe(3); // (300 + 10) / (90 + 10) = 3.1
    expect(at(2, 90, 10)).toBe(2);
    expect(at(0, 100, 10)).toBe(2); // 310 / 110 = 2.8
    expect(at(0, 400, 10)).toBe(1);
    expect(at(0, 0, 0)).toBe(300); // column-width is at least 1px
  });

  it('takes a px gap times the gap count in float', () => {
    const g = columnGeometry({ count: 2, width: { kind: 'auto' } }, px(15.5), 10, fromCssPx(100));
    expect(g).toEqual({ count: 2, width: divRaw(6400 - 992, 2), stride: 6400 - 992 + 1984 });
  });
});

function divRaw(raw: number, n: number): number {
  return Math.trunc(raw / n);
}

describe('balancing (ResolveColumnAutoBlockSize and the LayoutLine stretch loop)', () => {
  const ten = (n: number): LU[] => Array.from({ length: n }, () => lu(L));

  it('starts at the content over the count, rounded up to a LayoutUnit, and stretches by the least shortage', () => {
    // 40px over 3 is 853.3 raw, so 854: every column breaks after one line (an orphans violation, shortage 426), so the columns
    // stretch to 1280. Then column 1 overflows at line 3 with one widow, lays line 3 out, and breaks early before it.
    expect(balanceColumns(ten(4), 3)).toEqual({ starts: [0, 2], height: 1280 });
  });

  it('moves lines to the next column to leave two widows after the break', () => {
    // 50px over 2 is 25px: column 1 takes 0-1 (line 2 leaves one widow, so layout goes on and breaks early), column 2 takes 2-3 and
    // overflows with only line 4 left, so FinalizeForFragmentation breaks before line max(3 - 2, min(3, 2)) = 2; three columns stretch
    // by 320 raw to 30px.
    expect(balanceColumns(ten(5), 2)).toEqual({ starts: [0, 3], height: 1920 });
  });

  it('takes a line taller than the column at a column start and reports its shortage', () => {
    // 30 + 10 + 10 + 10 over 2 is 30px: line 1 alone in column 1 violates orphans, shortage 10px; at 40px lines 0-1 fit.
    expect(balanceColumns([lu(1920), lu(L), lu(L), lu(L)], 2)).toEqual({ starts: [0, 2], height: 2560 });
    expect(balanceColumns([lu(3200), lu(L)], 2)).toEqual({ starts: [0], height: 3840 });
  });

  it('starts at least as tall as the tallest line, which is unbreakable', () => {
    // One 10px line over 3 columns would be 214 raw; the tallest unbreakable line makes it 10px (ConstrainColumnBlockSize).
    expect(balanceColumns(ten(1), 3)).toEqual({ starts: [0], height: L });
    // 10 + 30 + 10 starts at the 30px line; one line per column violates orphans, so the columns stretch by 10px to two columns.
    expect(balanceColumns([lu(L), lu(3 * L), lu(L)], 3)).toEqual({ starts: [0, 2], height: 4 * L });
  });

  it('keeps one column for column-count 1 and none for no lines', () => {
    expect(balanceColumns(ten(3), 1)).toEqual({ starts: [0], height: 1920 });
    expect(balanceColumns([], 3)).toEqual({ starts: [0], height: 0 });
  });
});

describe('the lines of a multi-column container', () => {
  const words = 'XX XX XX XX XX XX XX';

  it('breaks lines at the column width and moves each column of lines to its column', () => {
    const b = box('m', { width: px(210), ...cols(3) }, [text('t', words)]);
    const lines = placeLines(ctx, b, fromCssPx(210));
    expect(lines.map((l) => [l.top, l.pieces[0]?.x, l.pieces[0]?.width])).toEqual([
      [0, 0, 50 * 64],
      [L, 0, 50 * 64],
      [0, 4693, 50 * 64],
      [L, 4693, 20 * 64],
    ]);
    const r = run(box('root', {}, [b]));
    expect(rect(r, 'm')).toMatchObject({ height: 20 * 64 });
    expect(rect(r, 't')).toMatchObject({ x: 0, y: 0, width: 4693 + 50 * 64, height: 20 * 64 });
  });

  it('places the columns from the right in rtl, each line aligned in its column', () => {
    const b = box('m', { width: px(210), direction: 'rtl', ...cols(3) }, [text('t', words)]);
    const lines = placeLines(ctx, b, fromCssPx(210));
    // Column 1 starts at 13440 - 0 - 4053 = 9387 raw, column 2 at 13440 - 4693 - 4053 = 4694; a 50px line starts 853 raw in.
    expect(lines.map((l) => l.pieces[0]?.x)).toEqual([9387 + 853, 9387 + 853, 4694 + 853, 4694 + 4053 - 20 * 64]);
  });

  it('adds the padding around the column block size', () => {
    const b = box('m', { width: px(210), paddingTop: px(3), paddingBottom: px(4), ...cols(2) }, [text('t', 'XX XX XX XX XX XX XX XX XX')]);
    const r = run(box('root', {}, [b]));
    // Three 80px lines in 100px columns: 15px columns break after one line each (orphans), so they stretch to 20px, and the
    // second column takes the last line after an early break.
    expect(rect(r, 'm')).toMatchObject({ height: (20 + 7) * 64 });
    expect(placeLines(ctx, b, fromCssPx(210)).map((l) => [l.top, l.pieces[0]?.x])).toEqual([[0, 0], [L, 0], [0, 6400 + 640]]);
  });

  it('lays out an empty multi-column container at zero block size', () => {
    expect(rect(run(box('root', {}, [box('m', cols(2))])), 'm')).toMatchObject({ height: 0 });
  });

  it('refuses what is not yet proven against Chrome, with a typed refusal', () => {
    const m = (style: Partial<LayoutStyle>, kids: Parameters<typeof box>[2] = [text('t', words)]) => refusal(run(box('root', {}, [box('m', { ...cols(2), ...style }, kids)])));
    expect(m({}, [span('s', [text('t', words)])])).toMatch(/^multicol: .* holds an inline box/);
    expect(m({ height: px(50) })).toMatch(/^multicol: .* specified block size/);
    expect(m({ maxHeight: px(50) })).toMatch(/^multicol: .* specified block size/);
    expect(m({ overflowX: 'hidden', overflowY: 'hidden' })).toMatch(/^multicol: .* clips its overflow/);
    expect(m({ columnGap: pct(10) })).toMatch(/^multicol: .* column gap/);
    expect(m({ textIndent: pct(10) })).toMatch(/^multicol: .* text-indent/);
    expect(m({}, [box('b', {}, [text('t', words)])])).toMatch(/^multicol: .* holds block-level boxes/);
    expect(m({}, [text('t', words, { whiteSpaceCollapse: 'preserve' })])).toMatch(/^multicol: .* preserves white space/);
    expect(refusal(run(box('root', { display: 'flex' }, [box('m', cols(2), [text('t', words)])])))).toMatch(/^multicol: .*-content size/);
  });
});

describe('validation', () => {
  const input = (root: LayoutBox) => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root });
  const codes = (root: LayoutBox): string[] => {
    const v = validateLayoutInput(input(root));
    return v.ok ? [] : v.errors.map((e) => `${e.code} ${e.path}`);
  };

  it('takes column-count, column-width or both on a block container', () => {
    expect(codes(box('root', cols(2)))).toEqual([]);
    expect(codes(box('root', cols(0, px(100))))).toEqual([]);
    expect(codes(box('root', cols(3, px(100))))).toEqual([]);
  });

  it('rejects both auto, a non-block container and a percentage column-width', () => {
    expect(codes(box('root', cols(0)))).toEqual(['multicol-shape $.root.style.multicol']);
    expect(codes(box('root', { display: 'flex', ...cols(2) }))).toEqual(['multicol-shape $.root.style.multicol']);
    expect(codes(box('root', { multicol: { count: 2, width: pct(50) as never } }))[0]).toMatch(/^unknown-tag \$\.root\.style\.multicol\.width/);
  });
});
