// REPL-r1: an img whose src is set at run time has a natural size the build may not read. A layout that completes with it is the
// layout of every image the app may load, because the natural size is no other input of the engine; a layout that reads it is
// refused (runtime-image-size), naming the fix. The parity fixtures replaced-runtime-* prove the accepted shapes against Chrome.
import { describe, expect, it } from 'vitest';
import type { GridContainerStyle, GridItemStyle, LayoutBox, LayoutInput, LayoutNode, LayoutStyle, NaturalSizeValue, ReplacedLeaf, TrackSize } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, layout } from '../src/index.ts';
import { ahemFont, box, divStyle, neutralEnvironment, pct, px, text } from './helpers.ts';

const AUTO: TrackSize = { kind: 'breadth', breadth: { kind: 'auto' } };
const track = (value: number): TrackSize => ({ kind: 'breadth', breadth: { kind: 'px', value } });
const fr = (value: number): TrackSize => ({ kind: 'breadth', breadth: { kind: 'fr', value } });
const autoItem: GridItemStyle = { column: { kind: 'auto', span: 1 }, row: { kind: 'auto', span: 1 }, justifySelf: 'auto' };
const gridStyle = (over: Partial<GridContainerStyle>): GridContainerStyle => ({ templateColumns: [], templateRows: [], autoColumns: [AUTO], autoRows: [AUTO], explicitColumnCount: 0, explicitRowCount: 0, autoRepeatColumns: null, autoRepeatRows: null, autoFlow: 'row', dense: false, justifyItems: 'normal', ...over });
const columns = (sizes: readonly TrackSize[]): Partial<GridContainerStyle> => ({ templateColumns: [{ count: 1, sizes: [...sizes] }], explicitColumnCount: sizes.length });

/** The samples Chrome loads in the parity fixtures (PNGs of these sizes; 0x0 is a loading image or no src), and the run-time natural. */
const SAMPLES: readonly NaturalSizeValue[] = [[400, 300], [4000, 100], [100, 4000], [1, 1], [3, 7], [0, 0]].map(([width, height]) => ({ kind: 'image', width: width as number, height: height as number }));
const RUNTIME: NaturalSizeValue = { kind: 'runtime' };

const img = (id: string, style: Partial<LayoutStyle>, natural: NaturalSizeValue): ReplacedLeaf => ({ kind: 'replaced', id, style: { ...divStyle, ...style }, natural, defaultWidth: 300, defaultHeight: 150, objectFit: 'cover', objectPositionX: pct(50), objectPositionY: pct(50) });
const ratio = (w: number, h: number, auto = false): LayoutStyle['aspectRatio'] => ({ kind: auto ? 'auto-ratio' : 'ratio', width: w * 64, height: h * 64 });

type Shape = (n: NaturalSizeValue) => LayoutBox;
const run = (root: LayoutBox) => {
  const viewport = { width: 390, height: 844 };
  const input: LayoutInput = { viewport, devicePixelRatio: 1, ...neutralEnvironment(viewport), root: box('root', {}, [root]) };
  return layout(input, ahemMeasurer);
};
const rects = (shape: Shape, n: NaturalSizeValue): string => {
  const r = run(shape(n));
  if (r.kind !== 'ok') throw new Error(`${r.unsupported.code}: ${r.unsupported.detail}`);
  return JSON.stringify([...absoluteRects(r.boxes)].sort(([a], [b]) => (a < b ? -1 : 1)));
};
const refusal = (shape: Shape): readonly string[] => {
  const r = run(shape(RUNTIME));
  return r.kind === 'unsupported' ? [r.unsupported.code, r.unsupported.nodeId, r.unsupported.detail] : [r.kind];
};

const ACCEPTED: { readonly [name: string]: Shape } = {
  'both sizes definite': (n) => box('c', {}, [img('i', { width: px(200), height: px(100) }, n)]),
  'both sizes with border, padding and border-box': (n) => box('c', {}, [img('i', { width: px(200), height: px(100), boxSizing: 'border-box', paddingLeft: px(7), paddingTop: px(3), paddingRight: px(2) }, n)]),
  'a width hint overridden, the height hint kept': (n) => box('c', {}, [img('i', { width: px(100), height: px(300), aspectRatio: ratio(400, 300, true) }, n)]),
  'a width and a plain ratio': (n) => box('c', {}, [img('i', { width: px(100), aspectRatio: ratio(2, 1) }, n)]),
  'a height and a plain ratio': (n) => box('c', {}, [img('i', { height: px(80), aspectRatio: ratio(3, 2) }, n)]),
  'an inline img in a line of text': (n) => box('c', {}, [text('t', 'ab', { font: ahemFont(20) }), img('i', { display: 'inline', width: px(40), height: px(20) }, n)]),
  'a flex row item with min-width 0': (n) => box('f', { display: 'flex', width: px(150) }, [img('i', { width: px(200), height: px(100), minWidth: px(0) }, n)]),
  'a flex column item with min-height 0': (n) => box('f', { display: 'flex', flexDirection: 'column', height: px(60) }, [img('i', { width: px(200), height: px(100), minHeight: px(0) }, n)]),
  'the checkin thumb: a 64x64 img in a 64px track': (n) => box('g', { display: 'grid', grid: gridStyle(columns([track(64), fr(1)])) }, [img('i', { width: px(64), height: px(64), gridItem: autoItem }, n), box('x', { gridItem: autoItem, height: px(10) })]),
  'a 100% wide img with a height in 1fr 1fr': (n) => box('g', { display: 'grid', grid: gridStyle(columns([fr(1), fr(1)])) }, [img('i', { width: pct(100), height: px(50), gridItem: autoItem }, n), box('x', { gridItem: autoItem })]),
  'the ProductCard: a grid card in a repeat(2, 1fr) grid': (n) => box('g', { display: 'grid', grid: gridStyle(columns([fr(1), fr(1)])) }, [box('card', { display: 'grid', grid: gridStyle({}), gridItem: autoItem }, [img('i', { width: pct(100), height: px(300), aspectRatio: ratio(4, 3), gridItem: autoItem }, n)])]),
  // One stretched auto column with definite free space never reads a max-content contribution (grid.ts growthLimitsUnused).
  'the product photo: 100% wide in one auto track': (n) => box('g', { display: 'grid', grid: gridStyle({}) }, [img('i', { width: pct(100), height: px(300), aspectRatio: ratio(400, 300, true), gridItem: autoItem }, n)]),
};

describe('REPL-r1: a layout that does not read the run-time natural size', () => {
  for (const [name, shape] of Object.entries(ACCEPTED)) {
    it(`${name}: the same boxes for every sample image, and for the run-time natural`, () => {
      const want = rects(shape, RUNTIME);
      for (const n of SAMPLES) expect(rects(shape, n), JSON.stringify(n)).toBe(want);
    });
  }
});

// The last flag says whether the read changes the layout. A read that cannot (Chrome measures the product photo and a wide flex row
// alike for every sample) is refused all the same, and its message names the CSS that removes it (Judge ruling Q8).
const REFUSED: readonly (readonly [string, Shape, string, boolean])[] = [
  ['an unsized img', (n) => box('c', {}, [img('i', {}, n)]), "its used size reads the image's natural ratio, since its height is auto: give it a CSS aspect-ratio, or a width and a height", true],
  ['the checkin detail photo: width 100% and an auto height', (n) => box('c', {}, [img('i', { width: pct(100), maxHeight: px(320) }, n)]), "its used size reads the image's natural ratio, since its height is auto: give it a CSS aspect-ratio, or a width and a height", true],
  ['a flex row item with min-width auto', (n) => box('f', { display: 'flex', width: px(150) }, [img('i', { width: px(200), height: px(100) }, n)]), "its content size as a flex item (its automatic minimum size or flex base size) reads the image's natural ratio: give it a min-width (a min-height in a column flex container)", true],
  ['a wide flex row item with min-width auto', (n) => box('f', { display: 'flex', width: px(400) }, [img('i', { width: px(200), height: px(100) }, n)]), "its content size as a flex item (its automatic minimum size or flex base size) reads the image's natural ratio: give it a min-width (a min-height in a column flex container)", false],
  ['a shrink-to-fit flex item holding a 100% wide img', (n) => box('f', { display: 'flex' }, [box('s', {}, [img('i', { width: pct(100), height: px(50) }, n)])]), "its max-content contribution (a shrink-to-fit width, an intrinsic grid track or a flex container's intrinsic size measures it) reads the image's natural ratio: give it a CSS aspect-ratio, or a width and a height", true],
];

describe('REPL-r1: a layout that reads the run-time natural size is refused, naming the read and its fix', () => {
  for (const [name, shape, detail, changes] of REFUSED) {
    it(name, () => {
      expect(refusal(shape)).toEqual(['runtime-image-size', 'i', detail]);
      expect(new Set(SAMPLES.map((n) => rects(shape, n))).size > 1).toBe(changes);
    });
  }

  it('the product photo is accepted once a CSS aspect-ratio replaces the attributes\' ratio, as the message says', () => {
    const fixed = (n: NaturalSizeValue): LayoutBox => box('g', { display: 'grid', grid: gridStyle({}) }, [img('i', { width: pct(100), height: px(300), aspectRatio: ratio(4, 3), gridItem: autoItem }, n)]);
    const want = rects(fixed, RUNTIME);
    for (const n of SAMPLES) expect(rects(fixed, n)).toBe(want);
  });
});

describe('REPL-r1: an img box whose child list holds nothing else is a leaf', () => {
  it('a layout node of the shapes above is a replaced leaf', () => {
    const n: LayoutNode = img('i', {}, RUNTIME);
    expect(n.kind).toBe('replaced');
  });
});
