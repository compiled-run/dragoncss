import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layout, layoutWithFaults, validateLayoutInput } from '../src/index.ts';
import type { LayoutBox, LayoutRect, LayoutResult, TextLeaf } from '../src/index.ts';
import { anon, box, px, text } from './helpers.ts';

// 10px Ahem: every glyph advances 640 LU, the glyph box is 640 LU high, line-height normal is 640 LU. Expected values are raw
// LayoutUnits, measured in Chrome 145 on the fixtures named in each test.
const G = 640;

function run(root: LayoutBox): LayoutResult {
  return layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root }, ahemMeasurer);
}

function rects(r: LayoutResult): Map<string, LayoutRect> {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return absoluteRects(r.boxes);
}

/** [x, y, width, height] of each line fragment of a leaf, absolute. */
function lines(r: LayoutResult, leaf: string): number[][] {
  const abs = rects(r);
  const out: number[][] = [];
  for (let j = 0; abs.has(`${leaf}:line${j}`); j++) {
    const l = abs.get(`${leaf}:line${j}`) as LayoutRect;
    out.push([l.x, l.y, l.width, l.height]);
  }
  return out;
}

const block = (width: number | null, leaves: TextLeaf[], style: Partial<LayoutBox['style']> = {}): LayoutBox =>
  box('root', {}, [box('a', { ...(width === null ? {} : { width: px(width) }), ...style }, leaves)]);

describe('line breaking (css-text-3 §5)', () => {
  it('breaks after spaces; the spaces that end a line hang and are not part of its fragment (text-wrap-spaces w1)', () => {
    expect(lines(run(block(30, [text('t', 'XX XX XX')])), 't')).toEqual([[0, 0, 2 * G, G], [0, G, 2 * G, G], [0, 2 * G, 2 * G, G]]);
  });
  it('a line that fits exactly keeps its content (text-wrap-spaces w2)', () => {
    expect(lines(run(block(50, [text('t', 'XX XX XX')])), 't')).toEqual([[0, 0, 5 * G, G], [0, G, 2 * G, G]]);
  });
  it('breaks at U+200B, which advances 0 (text-wrap-zwsp z1)', () => {
    expect(lines(run(block(30, [text('t', 'XX​YY​ZZ')])), 't')).toEqual([[0, 0, 2 * G, G], [0, G, 2 * G, G], [0, 2 * G, 2 * G, G]]);
  });
  it('an unbreakable word wider than the line overflows it alone (text-unbreakable-overflow o2)', () => {
    expect(lines(run(block(25, [text('t', 'X XXXXX X')])), 't')).toEqual([[0, 0, G, G], [0, G, 5 * G, G], [0, 2 * G, G, G]]);
  });
  it('text-wrap-mode nowrap keeps one line and overflows (text-unbreakable-overflow o4)', () => {
    expect(lines(run(block(30, [text('t', 'XX XX XX', { textWrapMode: 'nowrap' })])), 't')).toEqual([[0, 0, 8 * G, G]]);
  });
  it('leaves share one formatting context; a leaf whose only content on a line is a hanging space has no fragment there', () => {
    const r = run(block(30, [text('t0', 'XX'), text('t1', ' YY')]));
    expect(lines(r, 't0')).toEqual([[0, 0, 2 * G, G]]);
    expect(lines(r, 't1')).toEqual([[0, G, 2 * G, G]]);
    expect(rects(r).get('t1')).toMatchObject({ x: 0, y: G, width: 2 * G, height: G });
  });
  it('a word spanning two leaves is unbreakable, and a leaf fragment starts where the previous leaf ends', () => {
    const r = run(block(100, [text('t0', 'XX X'), text('t1', 'Y YY')]));
    expect(lines(r, 't0')).toEqual([[0, 0, 4 * G, G]]);
    expect(lines(r, 't1')).toEqual([[4 * G, 0, 4 * G, G]]);
    const narrow = run(block(30, [text('t0', 'XX X'), text('t1', 'Y YY')]));
    expect(lines(narrow, 't0')).toEqual([[0, 0, 2 * G, G], [0, G, G, G]]);
    expect(lines(narrow, 't1')).toEqual([[G, G, G, G], [0, 2 * G, 2 * G, G]]);
  });
  it('the box height is the number of lines times the line height', () => {
    const r = rects(run(block(30, [text('t', 'XX XX XX')])));
    expect(r.get('a')?.height).toBe(3 * G);
  });
});

describe('text-align (css-text-3 §7.1)', () => {
  const at = (align: LayoutBox['style']['textAlign'], width: number, value: string): number[][] => lines(run(block(width, [text('t', value)], { textAlign: align })), 't');
  it('center takes half the free space as LayoutUnit / 2, right and end all of it, per line (text-align-multi-line c, r, e)', () => {
    expect(at('center', 55, 'XX XX XXX X')).toEqual([[160, 0, 5 * G, G], [160, G, 5 * G, G]]);
    expect(at('right', 55, 'XX XX XXX X')).toEqual([[320, 0, 5 * G, G], [320, G, 5 * G, G]]);
    expect(at('end', 55, 'XX XX XXX X')).toEqual([[320, 0, 5 * G, G], [320, G, 5 * G, G]]);
    expect(at('left', 55, 'XX XX XXX X')).toEqual([[0, 0, 5 * G, G], [0, G, 5 * G, G]]);
  });
  it('an odd free space truncates: 50.3px leaves 19 LU, the centre offset is 9 LU (text-align-multi-line codd)', () => {
    expect(at('center', 50.3, 'XX XX XXX')[0]).toEqual([9, 0, 5 * G, G]);
  });
  it('an overflowing line starts at the start edge (text-align-multi-line co, ro)', () => {
    expect(at('center', 25, 'XXXXX XX')).toEqual([[0, 0, 5 * G, G], [160, G, 2 * G, G]]);
    expect(at('right', 25, 'XXXXX XX')).toEqual([[0, 0, 5 * G, G], [320, G, 2 * G, G]]);
  });
  it('hanging trailing spaces are left out of the aligned width', () => {
    expect(at('right', 30, 'XX XX')).toEqual([[G, 0, 2 * G, G], [G, G, 2 * G, G]]);
  });
});

describe('line height per line (CSS2 §10.8.1)', () => {
  const tops = (lh: TextLeaf['lineHeight']): { lines: number[][]; height: number | undefined } => {
    const r = run(block(30, [text('t', 'XX XX XX', { lineHeight: lh })]));
    return { lines: lines(r, 't'), height: rects(r).get('a')?.height };
  };
  it('line k is at k times the line height plus the floored half-leading (text-line-height-multi-line px)', () => {
    expect(tops({ kind: 'px', value: 17 })).toEqual({ lines: [[0, 192, 2 * G, G], [0, 1280, 2 * G, G], [0, 2368, 2 * G, G]], height: 3 * 1088 });
  });
  it('a number multiplies the font size (text-line-height-multi-line num)', () => {
    expect(tops({ kind: 'number', value: 1.5 })).toEqual({ lines: [[0, 128, 2 * G, G], [0, 1088, 2 * G, G], [0, 2048, 2 * G, G]], height: 3 * 960 });
  });
  it('a line-height below the glyph height gives negative leading, floored: -2.5px becomes -3px (text-line-height-multi-line neg5)', () => {
    expect(tops({ kind: 'px', value: 5 })).toEqual({ lines: [[0, -192, 2 * G, G], [0, 128, 2 * G, G], [0, 448, 2 * G, G]], height: 3 * 320 });
    expect(tops({ kind: 'px', value: 7 }).lines.map((l) => l[1])).toEqual([-128, 320, 768]);
  });
});

describe('intrinsic sizes of text (css-sizing-3 §5.1)', () => {
  it('a flex item shrinks to its min-content, the widest segment, and wraps (text-wrap-zwsp z5)', () => {
    const r = rects(run(box('root', {}, [box('row', { display: 'flex', width: px(20) }, [box('i', {}, [text('t', 'XXX​XX')])])])));
    expect(r.get('i')).toMatchObject({ width: 3 * G, height: 2 * G });
  });
  it('an anonymous flex item is a box like any other (flex-text-anonymous-item f2)', () => {
    const r = rects(run(box('root', {}, [box('f', { display: 'flex', flexDirection: 'column', width: px(30) }, [anon('f:anon0', {}, [text('t', 'XX XX XX')])])])));
    expect(r.get('f:anon0')).toMatchObject({ width: 30 * 64, height: 3 * G });
  });
});

describe('planted engine fault breakOffByOne', () => {
  it('lets a line take one glyph more than fits', () => {
    const root = block(45, [text('t', 'XX XX')]);
    const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root };
    expect(lines(layout(input, ahemMeasurer), 't').length).toBe(2);
    expect(lines(layoutWithFaults(input, ahemMeasurer, { breakOffByOne: true }), 't').length).toBe(1);
  });
});

describe('the validator rejects text the compiler did not prepare', () => {
  const codes = (root: LayoutBox): string[] => {
    const v = validateLayoutInput(JSON.parse(JSON.stringify({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root })));
    return v.ok ? [] : v.errors.map((e) => e.code);
  };
  it('accepts collapsed text, including a single space leaf between runs', () => {
    expect(codes(block(30, [text('t0', 'XX'), text('t1', ' '), text('t2', 'YY')]))).toEqual([]);
  });
  it('rejects text mixed with boxes and text directly in a flex container', () => {
    expect(codes(box('root', {}, [box('a', {}, [text('t', 'XX'), box('b', {})])]))).toEqual(['mixed-children']);
    expect(codes(box('root', {}, [box('f', { display: 'flex' }, [text('t', 'XX')])]))).toEqual(['text-in-flex']);
  });
  it('rejects uncollapsed text: doubled spaces, tabs, segment breaks, edge spaces, empty leaves, spaces doubled across leaves', () => {
    for (const leaves of [
      [text('t', 'XX  XX')],
      [text('t', 'XX\tXX')],
      [text('t', 'XX\nXX')],
      [text('t', ' XX')],
      [text('t', 'XX ')],
      [text('t0', 'XX'), text('t1', '')],
      [text('t0', 'XX '), text('t1', ' YY')],
    ]) expect(codes(block(30, leaves)), JSON.stringify(leaves.map((l) => l.text))).toEqual(['uncollapsed-text']);
  });
  it('rejects white-space-collapse values other than collapse', () => {
    const bad = JSON.parse(JSON.stringify(block(30, [text('t', 'XX')]))) as { children: { children: Record<string, unknown>[] }[] };
    (bad.children[0]?.children[0] as Record<string, unknown>)['whiteSpaceCollapse'] = 'preserve';
    expect(codes(bad as unknown as LayoutBox)).toEqual(['bad-value']);
  });
});

describe('engine refusals for text', () => {
  it('different fonts in one formatting context return mixed-inline-font', () => {
    const r = run(block(30, [text('t0', 'XX'), text('t1', 'YY', { font: { family: 'Ahem', size: 12 } })]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('mixed-inline-font');
  });
  it('text-align: justify returns text-align until a fixture proves it', () => {
    const r = run(block(30, [text('t', 'XX XX')], { textAlign: 'justify' }));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('text-align');
  });
  it('a code point Ahem does not cover returns text-glyph', () => {
    const r = run(block(30, [text('t', 'Xé')]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('text-glyph');
  });
});
