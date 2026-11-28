// REPL-r2a: an img whose src is set at run time and whose height follows its image. The device gives its natural size (0 by 0
// while it loads); the engine reads it only for a used size whose inline size is definite without the image, so the image moves
// block sizes and nothing else. Every other read is refused as in REPL-r1 (runtime-image-size).
import { describe, expect, it } from 'vitest';
import type { LayoutBox, LayoutInput, LayoutStyle, NaturalSizeValue, ReplacedLeaf } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, layout, layoutWithFaults, NO_ENGINE_FAULTS } from '../src/index.ts';
import { ahemFont, box, divStyle, neutralEnvironment, pct, px, text } from './helpers.ts';

/** The spec's samples (REPL-r2a "The sweep", Judge amendment 6): loading, square, the common camera ratios, both clamp extremes. */
const SIZES: readonly (readonly [number, number])[] = [[0, 0], [1, 1], [4000, 3000], [3000, 4000], [1000, 1000], [1920, 1080], [1080, 1920], [1000, 100], [100, 1000], [1, 1000], [1000, 1]];

const img = (id: string, style: Partial<LayoutStyle>, natural: NaturalSizeValue): ReplacedLeaf => ({ kind: 'replaced', id, style: { ...divStyle, display: 'block', ...style }, natural, defaultWidth: 300, defaultHeight: 150, objectFit: 'cover', objectPositionX: { kind: 'percent', value: 50 }, objectPositionY: { kind: 'percent', value: 50 } });

type Shape = (n: NaturalSizeValue) => LayoutBox;
const run = (root: LayoutBox, faults = NO_ENGINE_FAULTS) => {
  const viewport = { width: 390, height: 844 };
  const input: LayoutInput = { viewport, devicePixelRatio: 1, ...neutralEnvironment(viewport), root: box('root', {}, [root]) };
  return faults === NO_ENGINE_FAULTS ? layout(input, ahemMeasurer) : layoutWithFaults(input, ahemMeasurer, faults);
};
const rects = (shape: Shape, n: NaturalSizeValue): Map<string, readonly number[]> => {
  const r = run(shape(n));
  if (r.kind !== 'ok') throw new Error(`${r.unsupported.code}: ${r.unsupported.detail}`);
  return new Map([...absoluteRects(r.boxes)].map(([id, rect]) => [id, [rect.x, rect.y, rect.width, rect.height]]));
};
const followed = (width: number, height: number): NaturalSizeValue => ({ kind: 'followed', width, height });
const image = (width: number, height: number): NaturalSizeValue => ({ kind: 'image', width, height });

// The checkin /checkins/[id] photo: 100% wide, max-height 320px, then a heading and text below it.
const PHOTO: Shape = (n) => box('a', {}, [img('i', { width: pct(100), maxHeight: px(320) }, n), box('h', { height: px(30) }), box('p', {}, [text('t', 'ab cd', { font: ahemFont(20) })])]);
const FOLLOWS: { readonly [name: string]: Shape } = {
  'the checkin photo: 100% wide with a max-height': PHOTO,
  'a fixed width and an auto height': (n) => box('a', {}, [img('i', { width: px(200) }, n), box('x', { height: px(10) })]),
};

describe('REPL-r2a: an img that follows its image', () => {
  for (const [name, shape] of Object.entries(FOLLOWS)) {
    it(`${name}: lays out as Dragon lays out the same image known at build time, for every sample`, () => {
      for (const [w, h] of SIZES) expect(rects(shape, followed(w, h)), `${w}x${h}`).toEqual(rects(shape, image(w, h)));
    });
    it(`${name}: no inline size depends on the image (rule 2)`, () => {
      const loading = rects(shape, followed(0, 0));
      for (const [w, h] of SIZES) {
        for (const [id, r] of rects(shape, followed(w, h))) expect([id, r[0], r[2]], `${w}x${h}`).toEqual([id, loading.get(id)?.[0], loading.get(id)?.[2]]);
      }
    });
  }

  it('the checkin photo: the box is 0 high while loading, then min(width x h / w, max-height)', () => {
    const at = (n: NaturalSizeValue): readonly number[] => (rects(PHOTO, n).get('i') as readonly number[]).map((v) => v / 64);
    expect(at(followed(0, 0))[3]).toBe(0);
    expect(at(followed(4000, 3000))[3]).toBe(292.5);
    expect(at(followed(3000, 4000))[3]).toBe(320);
    expect((rects(PHOTO, followed(3000, 4000)).get('h')?.[1] ?? 0) / 64).toBe(320);
  });

  it('a read that reaches an inline size stays refused, and the planted fault lets it through', () => {
    const autoWidth: Shape = (n) => box('a', {}, [img('i', { maxHeight: px(320) }, n)]);
    const shrink: Shape = (n) => box('fl', { float: 'left' }, [img('i', { width: pct(100) }, n)]);
    // A flex item's base size reads its content size, whatever its width.
    const flexColumn: Shape = (n) => box('f', { display: 'flex', flexDirection: 'column', width: px(300) }, [img('i', { width: pct(100), minHeight: px(0) }, n)]);
    for (const shape of [autoWidth, shrink, flexColumn]) {
      const r = run(shape(followed(4000, 3000)));
      expect(r.kind === 'unsupported' ? [r.unsupported.code, r.unsupported.nodeId] : [r.kind]).toEqual(['runtime-image-size', 'i']);
    }
    expect(run(autoWidth(followed(4000, 3000)), { ...NO_ENGINE_FAULTS, runtimeFollowsReadUnguarded: true }).kind).toBe('ok');
  });
});
