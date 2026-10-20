// FLT: floats (CSS2 §9.5, §10.3.5, §10.6.7). The parity fixtures float-* compare these boxes with Chrome; these pin the engine's
// placement rules (float.ts placeFloat), shrink-to-fit widths, formatting context root heights and refusals.
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS, validateLayoutInput } from '../src/index.ts';
import type { LayoutBox, LayoutInput, LayoutStyle, ReplacedLeaf } from '../src/index.ts';
import { hitRefusal } from '../src/rt-hit.ts';
import { placeFloat } from '../src/float.ts';
import type { LU } from '../src/units.ts';
import { box, divStyle, neutralEnvironment, px, text } from './helpers.ts';

const env = (root: LayoutBox): LayoutInput => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root });
type R = { x: number; y: number; width: number; height: number };
function rects(root: LayoutBox): Map<string, R> {
  const r = layoutWithFaults(env(root), ahemMeasurer, NO_ENGINE_FAULTS);
  if (r.kind !== 'ok') throw new Error(`${r.unsupported.code}: ${r.unsupported.detail}`);
  const out = new Map<string, R>();
  for (const [id, b] of absoluteRects(r.boxes)) out.set(id, { x: b.x / 64, y: b.y / 64, width: b.width / 64, height: b.height / 64 });
  return out;
}
const at = (m: Map<string, R>, id: string): R => m.get(id) as R;
const codeOf = (root: LayoutBox): string => {
  const r = layoutWithFaults(env(root), ahemMeasurer, NO_ENGINE_FAULTS);
  return r.kind === 'ok' ? 'ok' : r.unsupported.code;
};
const fl = (id: string, side: 'left' | 'right', style: Partial<LayoutStyle> = {}, kids: LayoutBox['children'][number][] = []): LayoutBox => box(id, { float: side, ...style }, kids);
const sized = (id: string, side: 'left' | 'right', w: number, h: number, style: Partial<LayoutStyle> = {}): LayoutBox => fl(id, side, { width: px(w), height: px(h), ...style });

describe('FLT: float placement (CSS2 §9.5.1)', () => {
  it('ignores a zero-width float beside the next one, though its top still holds later floats down (Chrome 145)', () => {
    const w = (kids: LayoutBox[]): LayoutBox => box('root', {}, [box('w', { width: px(100), overflowX: 'hidden', overflowY: 'hidden' }, kids)]);
    const m = rects(w([sized('a', 'left', 50, 10), sized('z', 'left', 0, 30), sized('c', 'left', 60, 5)]));
    expect([at(m, 'c').x, at(m, 'c').y, at(m, 'w').height]).toEqual([0, 10, 30]);
  });

  it('refuses a float with an aspect-ratio and an auto width, whose shrink-to-fit width it does not transfer, and sizes one with a width', () => {
    expect(codeOf(box('root', {}, [box('w', { overflowX: 'hidden', overflowY: 'hidden' }, [fl('a', 'left', { height: px(20), aspectRatio: { kind: 'ratio', width: 128, height: 64 } })])]))).toBe('float');
    const m = rects(box('root', {}, [box('w', { width: px(100), overflowX: 'hidden', overflowY: 'hidden' }, [fl('a', 'left', { width: px(30), aspectRatio: { kind: 'ratio', width: 128, height: 64 } })])]));
    expect([at(m, 'a').width, at(m, 'a').height]).toEqual([30, 15]);
  });

  it('places floats side by side, and a float that does not fit below the nearest float bottom that leaves room', () => {
    const left = { side: 'left' as const };
    const u = (n: number): LU => (n * 64) as LU;
    const a = placeFloat([], 'left', u(40), u(10), u(0), u(100));
    expect(a).toEqual({ ...left, x: 0, y: 0, width: 40 * 64, height: 10 * 64 });
    const b = placeFloat([a], 'left', u(40), u(20), u(0), u(100));
    expect(b.x).toBe(40 * 64);
    // At y 0 only 20px are left; at a's bottom (10) b still holds the line to 80px; at b's bottom (20) the line is free.
    const c = placeFloat([a, b], 'left', u(40), u(10), u(0), u(100));
    expect([c.x, c.y]).toEqual([0, 20 * 64]);
    // A right float takes the right edge, beside left floats while it fits; and never goes above an earlier float's top (rule 5).
    expect(placeFloat([a], 'right', u(30), u(10), u(0), u(100)).x).toBe(70 * 64);
    expect(placeFloat([c], 'right', u(30), u(10), u(0), u(100)).y).toBe(20 * 64);
    // A float wider than the content box goes where no float is beside it.
    expect(placeFloat([a], 'left', u(120), u(10), u(0), u(100))).toEqual({ ...left, x: 0, y: 10 * 64, width: 120 * 64, height: 10 * 64 });
  });

  it('lays out a float shrink-to-fit at its flow position; its parent does not grow, the formatting context root does', () => {
    // The coverage probe's shape: a float of two blocks of text in an otherwise empty block.
    const m = rects(box('root', {}, [box('p', {}, [fl('u', 'left', {}, [box('c1', {}, [text('t1', 'Hi')]), box('c2', {}, [text('t2', 'Hi')])])])]));
    expect(at(m, 'u')).toEqual({ x: 0, y: 0, width: 20, height: 20 });
    expect(at(m, 'p').height).toBe(0);
    expect(at(m, 'root').height).toBe(20);
  });

  it('places left and right floats in their container with their margins, and a root around them', () => {
    const m = rects(box('root', {}, [box('w', { width: px(200), overflowX: 'hidden', overflowY: 'hidden' }, [
      sized('a', 'left', 50, 30, { marginLeft: px(5), marginBottom: px(4) }),
      sized('b', 'right', 60, 10),
      sized('c', 'left', 50, 10),
      sized('d', 'left', 50, 10),
    ])]));
    expect(at(m, 'a')).toEqual({ x: 5, y: 0, width: 50, height: 30 });
    expect(at(m, 'b')).toEqual({ x: 140, y: 0, width: 60, height: 10 });
    expect(at(m, 'c')).toEqual({ x: 55, y: 0, width: 50, height: 10 });
    // At y 0 there are 35px between c and b; d goes down to b's and c's bottom (10), beside a.
    expect(at(m, 'd')).toEqual({ x: 55, y: 10, width: 50, height: 10 });
    // overflow: hidden makes w a formatting context root: its height reaches a's bottom margin edge.
    expect(at(m, 'w').height).toBe(34);
  });

  it('starts below the boxes before it, after their margins, and floats a replaced box at its own size', () => {
    const img: ReplacedLeaf = { kind: 'replaced', id: 'i', style: { ...divStyle, float: 'right', marginTop: px(3) }, natural: { kind: 'image', width: 16, height: 8 }, defaultWidth: 300, defaultHeight: 150, objectFit: 'fill', objectPositionX: px(0), objectPositionY: px(0) };
    const m = rects(box('root', { width: px(100) }, [box('k', { height: px(12), marginBottom: px(6) }), img]));
    expect(at(m, 'i')).toEqual({ x: 84, y: 21, width: 16, height: 8 });
  });

  it('validates a float only as a block-level box in flow, never the root, an absolutely positioned box or an atomic inline', () => {
    const errors = (root: LayoutBox): string[] => {
      const v = validateLayoutInput(JSON.parse(JSON.stringify(env(root))));
      return v.ok ? [] : [...new Set(v.errors.map((e) => e.code))];
    };
    expect(errors(box('root', {}, [sized('a', 'left', 10, 10)]))).toEqual([]);
    expect(errors(fl('root', 'left'))).toContain('bad-value');
    expect(errors(box('root', {}, [sized('a', 'left', 10, 10, { position: 'absolute' })]))).toContain('bad-value');
    expect(errors(box('root', {}, [box('c', {}, [text('t', 'a'), sized('a', 'left', 10, 10, { display: 'inline-block' })])]))).toContain('bad-value');
  });

  it('refuses a relatively positioned float and a negative margin on one', () => {
    expect(codeOf(box('root', {}, [sized('a', 'left', 10, 10, { position: 'relative' })]))).toBe('float');
    expect(codeOf(box('root', {}, [sized('a', 'left', 10, 10, { marginTop: px(-2) })]))).toBe('float');
    expect(codeOf(box('root', {}, [sized('a', 'left', 10, 10)]))).toBe('ok');
  });

  it('sizes a box by its content with its floats side by side: each side adds up, then both sides (Blink ComputeMinMaxSizes)', () => {
    // k floats, so it is shrink-to-fit: max-content is 10 + 15 on the left plus 20 on the right, beside its 30px in-flow block.
    const m = rects(box('root', {}, [box('k', { float: 'left' }, [box('b', { width: px(30), height: px(5) }), sized('a', 'left', 10, 10), sized('c', 'right', 20, 10), sized('d', 'left', 15, 10)])]));
    expect(at(m, 'k').width).toBe(45);
    expect(at(m, 'a')).toEqual({ x: 0, y: 5, width: 10, height: 10 });
    expect(at(m, 'd')).toEqual({ x: 10, y: 5, width: 15, height: 10 });
    expect(at(m, 'c')).toEqual({ x: 25, y: 5, width: 20, height: 10 });
    expect(at(m, 'k').height).toBe(15);
  });

  it('is refused by the hit table (no Chrome hit capture), but a float in a flex container is a flex item', () => {
    expect(hitRefusal(env(box('root', {}, [sized('a', 'left', 10, 10)])))).toMatch(/^a is a float/);
    expect(hitRefusal(env(box('root', { display: 'flex' }, [sized('a', 'left', 10, 10)])))).toBeNull();
  });
});
