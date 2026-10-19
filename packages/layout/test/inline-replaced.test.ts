// RF-INL: an inline-level replaced box is an atomic inline (css-display-3 §2.4). It is sized as a block-level replaced box is (CSS
// 2.2 §10.3.2, §10.6.2) and has no baseline of its own, so its bottom margin edge sits on the baseline (CSS2 §10.8.1). The parity
// fixtures inline-replaced-img and inline-replaced-svg compare these boxes with Chrome; these pin the engine's rules.
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS, validateLayoutInput } from '../src/index.ts';
import { hitRefusal } from '../src/rt-hit.ts';
import type { EngineFaults, InlineChild, LayoutBox, LayoutInput, LayoutRect, LayoutStyle, LineStrut, ReplacedLeaf } from '../src/index.ts';
import { ahemFont, box, divStyle, neutralEnvironment, px, text } from './helpers.ts';

const env = (root: LayoutBox): LayoutInput => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root });
/** A 20px Ahem strut with line-height 1: ascent 16px, descent 4px, no leading. */
const STRUT: LineStrut = { font: ahemFont(20), lineHeight: { kind: 'number', value: 1 } };
const t20 = (id: string, value: string) => text(id, value, { font: ahemFont(20), lineHeight: { kind: 'number', value: 1 } });
/** An inline img with a 64x64 natural size. */
const img = (id: string, style: Partial<LayoutStyle> = {}): ReplacedLeaf => ({
  kind: 'replaced',
  id,
  style: { ...divStyle, display: 'inline', ...style },
  natural: { kind: 'image', width: 64, height: 64 },
  defaultWidth: 300,
  defaultHeight: 150,
  objectFit: 'fill',
  objectPositionX: { kind: 'percent', value: 50 },
  objectPositionY: { kind: 'percent', value: 50 },
});
const line = (kids: (InlineChild | LayoutBox | ReplacedLeaf)[], style: Partial<LayoutStyle> = {}): LayoutBox => box('root', {}, [box('c', style, kids, STRUT)]);
/** Every box's absolute border box in px. */
function rects(root: LayoutBox, faults: EngineFaults = NO_ENGINE_FAULTS): Map<string, { x: number; y: number; width: number; height: number }> {
  const r = layoutWithFaults(env(root), ahemMeasurer, faults);
  if (r.kind !== 'ok') throw new Error(r.unsupported.code);
  const out = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const [id, b] of absoluteRects(r.boxes)) out.set(id, { x: b.x / 64, y: b.y / 64, width: b.width / 64, height: b.height / 64 });
  return out;
}
const at = (m: ReturnType<typeof rects>, id: string) => m.get(id) as LayoutRect;

describe('RF-INL: inline-level replaced boxes', () => {
  it('sits alone on a line with its bottom edge on the baseline, so the strut descent stays below it', () => {
    const m = rects(line([img('a', { width: px(20), height: px(20) })]));
    expect(at(m, 'a')).toEqual({ x: 0, y: 0, width: 20, height: 20 });
    // The line is the image's 20px above the baseline and the strut's 4px descent below it.
    expect(at(m, 'c').height).toBe(24);
  });
  it('sits beside text on the shared baseline, at its natural size with no width or height', () => {
    const m = rects(line([t20('t', 'ab'), img('a', { width: px(20), height: px(20) }), t20('u', 'cd')]));
    expect(at(m, 'a')).toEqual({ x: 40, y: 0, width: 20, height: 20 });
    expect(at(m, 't').y).toBe(4);
    const n = rects(line([t20('t', 'a'), img('a'), t20('u', 'b')]));
    expect(at(n, 'a')).toEqual({ x: 20, y: 0, width: 64, height: 64 });
    expect(at(n, 'c').height).toBe(68);
  });
  it('takes its margin box on the line: the margins advance the pen and the bottom margin edge is on the baseline', () => {
    const style: Partial<LayoutStyle> = { width: px(16), height: px(12), marginTop: px(2), marginRight: px(3), marginBottom: px(5), marginLeft: px(4), paddingTop: px(1), paddingBottom: px(1), paddingLeft: px(2), paddingRight: px(2) };
    const m = rects(line([t20('t', 'a'), img('a', style), t20('u', 'b')]));
    // Border box 20x14 (content box sizing); margin box 27x21 above the baseline, which is 21px down, so the text top is 5px.
    expect(at(m, 'a')).toEqual({ x: 24, y: 2, width: 20, height: 14 });
    expect(at(m, 't').y).toBe(5);
    expect(at(m, 'u').x).toBe(47);
  });
  it('wraps around its line like any atomic inline: a soft wrap opportunity before and after it', () => {
    const m = rects(line([t20('t', 'a '), img('a', { width: px(20), height: px(20) }), t20('u', ' b '), img('b', { width: px(20), height: px(20) }), t20('v', ' c')], { width: px(70) }));
    expect(at(m, 'a').y).toBe(0);
    expect(at(m, 'b').y).toBe(24);
  });
  it('contributes its margin box to its container\'s shrink-to-fit width', () => {
    const shrink = box('k', { display: 'inline-block' }, [img('a', { width: px(20), height: px(10), marginLeft: px(3) })], STRUT);
    const m = rects(line([t20('t', 'a'), shrink, t20('u', 'b')]));
    expect(at(m, 'k').width).toBe(23);
  });
  it('validates as an atomic inline among inline content only, never inside an inline box or beside blocks', () => {
    const errors = (root: LayoutBox): string[] => {
      const v = validateLayoutInput(JSON.parse(JSON.stringify(env(root))));
      return v.ok ? [] : [...new Set(v.errors.map((e) => e.code))];
    };
    expect(errors(line([t20('t', 'a'), img('a'), t20('u', 'b')]))).toEqual([]);
    expect(errors(line([img('a', { display: 'inline-block' })]))).toEqual([]);
    const inBox = { kind: 'inline', id: 's', style: { ...divStyle, display: 'inline' }, font: ahemFont(20), lineHeight: { kind: 'number', value: 1 }, children: [img('a')] } as unknown as InlineChild;
    expect(errors(line([t20('t', 'a'), inBox]))).toContain('atomic-in-inline-box');
    expect(errors(box('root', {}, [box('c', {}, [box('k', {}), img('a')], null)]))).toContain('mixed-children');
  });
  it('refuses what every atomic inline refuses: relative position, vertical-align other than baseline, a percentage height', () => {
    const code = (style: Partial<LayoutStyle>): string => {
      const r = layoutWithFaults(env(line([t20('t', 'a'), img('a', style)])), ahemMeasurer, NO_ENGINE_FAULTS);
      return r.kind === 'ok' ? 'ok' : r.unsupported.code;
    };
    expect(code({ position: 'relative' })).toBe('inline-box-position');
    expect(code({ verticalAlign: { kind: 'keyword', value: 'middle' } })).toBe('vertical-align');
    expect(code({ height: { kind: 'percent', value: 50 } })).toBe('percent-height-flex');
    expect(code({})).toBe('ok');
  });
  it('plant atomicMarginExcluded drops its margins from the line', () => {
    const m = rects(line([t20('t', 'a'), img('a', { width: px(20), height: px(20), marginLeft: px(6) }), t20('u', 'b')]), { ...NO_ENGINE_FAULTS, atomicMarginExcluded: true });
    expect(at(m, 'a').x).toBe(20);
  });
  it('is refused by the hit table, as every atomic inline is (no Chrome hit capture)', () => {
    expect(hitRefusal(env(line([t20('t', 'a'), img('a')])))).toMatch(/^a is an atomic inline/);
  });
});
