import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layout, validateLayoutInput } from '../src/index.ts';
import type { AspectRatioValue, LayoutBox, LayoutRect, LayoutStyle, TextLeaf } from '../src/index.ts';
import { box, pct, px, text } from './helpers.ts';

// SIZE-ar (T050): aspect-ratio on non-replaced boxes, pinned to rects measured in Chrome 145.0.7632.6 (probe markup mirrored
// here: body margin 0, 10px Ahem, a 400x300 viewport). Layout ratios are raw LayoutUnit pairs, as the compiler writes them.
const r = (w: number, h: number): AspectRatioValue => ({ kind: 'ratio', width: w * 64, height: h * 64 });
const raw = (width: number, height: number): AspectRatioValue => ({ kind: 'ratio', width, height });
const t = (id: string, s: string) => text(`${id}:text0`, s);
const edges = (side: 'padding' | 'border', top: number, right: number, bottom = top, left = right): Partial<LayoutStyle> =>
  side === 'padding'
    ? { paddingTop: px(top), paddingRight: px(right), paddingBottom: px(bottom), paddingLeft: px(left) }
    : { borderTopWidth: px(top), borderRightWidth: px(right), borderBottomWidth: px(bottom), borderLeftWidth: px(left) };

function run(body: LayoutBox[], bodyStyle: Partial<LayoutStyle> = {}): Map<string, LayoutRect> {
  const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root: box('html', {}, [box('body', bodyStyle, body)]) };
  const v = validateLayoutInput(input);
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  const out = layout(v.input, ahemMeasurer);
  if (out.kind !== 'ok') throw new Error(JSON.stringify(out.unsupported));
  return absoluteRects(out.boxes);
}

/** Border box in CSS px: x, y, width, height. */
function at(m: Map<string, LayoutRect>, id: string): number[] {
  const b = m.get(id);
  if (b === undefined) throw new Error(`${id} was not laid out`);
  return [b.x / 64, b.y / 64, b.width / 64, b.height / 64];
}

describe('block-level: the auto height comes from the width', () => {
  it('truncates the transferred size to LayoutUnits (Blink LayoutUnit::MulDiv)', () => {
    const cases: [number, AspectRatioValue, number][] = [
      [100, r(16, 9), 56.25],
      [101, r(16, 9), 56.8125],
      [100, r(7, 3), 42.84375],
      [100, r(3, 7), 233.328125],
      [100, raw(7, 10), 142.84375],
      [100, r(1000, 1), 0.09375],
      [10, r(1, 1000), 10000],
    ];
    for (const [w, ratio, h] of cases) expect(at(run([box('a', { width: px(w), aspectRatio: ratio })]), 'a')[3]).toBe(h);
  });
  it('a stretched width gives the height', () => {
    expect(at(run([box('a', { aspectRatio: r(4, 1) })]), 'a')).toEqual([0, 0, 400, 100]);
  });
  it('box-sizing picks the box the ratio sizes; auto && <ratio> always sizes the content box', () => {
    const bp = { width: px(100), ...edges('padding', 5, 10), ...edges('border', 3, 3) };
    expect(at(run([box('a', { ...bp, boxSizing: 'border-box', aspectRatio: r(2, 1) })]), 'a')).toEqual([0, 0, 100, 50]);
    expect(at(run([box('a', { ...bp, aspectRatio: r(2, 1) })]), 'a')).toEqual([0, 0, 126, 66]);
    expect(at(run([box('a', { ...bp, boxSizing: 'border-box', aspectRatio: { kind: 'auto-ratio', width: 128, height: 64 } })]), 'a')).toEqual([0, 0, 100, 53]);
  });
  it('taller content wins through the automatic minimum size, except in a scroll container or under min-height', () => {
    const a = (s: Partial<LayoutStyle>) => [box('a', { width: px(40), aspectRatio: r(4, 1), ...s }, [t('a', 'XX XX XX')])];
    expect(at(run(a({})), 'a')[3]).toBe(30);
    expect(at(run(a({ overflowX: 'hidden', overflowY: 'hidden' })), 'a')[3]).toBe(10);
    expect(at(run(a({ maxHeight: px(15) })), 'a')[3]).toBe(15);
    expect(at(run(a({ minHeight: px(0) })), 'a')[3]).toBe(10);
  });
  it('min-height and max-height clamp the ratio height, which is definite for percentage children', () => {
    const m = run([box('a', { width: px(100), aspectRatio: r(1, 1), minHeight: px(120) }), box('b', { width: px(100), aspectRatio: r(1, 1), maxHeight: px(60) })]);
    expect([at(m, 'a'), at(m, 'b')]).toEqual([[0, 0, 100, 120], [0, 120, 100, 60]]);
    const c = run([box('a', { width: px(100), aspectRatio: r(2, 1) }, [box('c', { height: pct(50) })])]);
    expect([at(c, 'a'), at(c, 'c')]).toEqual([[0, 0, 100, 50], [0, 0, 100, 25]]);
  });
  it('a definite height gives an auto width through the ratio, clamped by min-width and max-width, and centred by auto margins', () => {
    expect(at(run([box('a', { height: px(50), aspectRatio: r(2, 1) })]), 'a')).toEqual([0, 0, 100, 50]);
    const m = run([box('a', { height: px(50), aspectRatio: r(2, 1), maxWidth: px(70) }), box('b', { height: px(50), aspectRatio: r(2, 1), minWidth: px(150) })]);
    expect([at(m, 'a'), at(m, 'b')]).toEqual([[0, 0, 70, 50], [0, 50, 150, 50]]);
    expect(at(run([box('a', { height: px(50), aspectRatio: r(2, 1), marginLeft: { kind: 'auto' }, marginRight: { kind: 'auto' } })]), 'a')).toEqual([150, 0, 100, 50]);
    expect(at(run([box('a', { height: px(50), width: px(30), aspectRatio: r(2, 1) })]), 'a')).toEqual([0, 0, 30, 50]);
    const h = run([box('a', { height: px(50), aspectRatio: r(2, 1), maxHeight: px(30) }), box('b', { height: px(50), aspectRatio: r(2, 1), minHeight: px(80) })]);
    expect([at(h, 'a'), at(h, 'b')]).toEqual([[0, 0, 60, 30], [0, 30, 160, 80]]);
  });
  it('min-height, max-height and min-width transfer through the ratio into a stretched width', () => {
    const m = run([box('a', { aspectRatio: r(2, 1), minHeight: px(300) }), box('b', { aspectRatio: r(2, 1), maxHeight: px(20) })]);
    expect([at(m, 'a'), at(m, 'b')]).toEqual([[0, 0, 600, 300], [0, 300, 40, 20]]);
    const n = run([box('p', { width: px(100) }, [box('a', { aspectRatio: r(2, 1), minWidth: px(150) })])]);
    expect([at(n, 'p'), at(n, 'a')]).toEqual([[0, 0, 100, 75], [0, 0, 150, 75]]);
  });
});

describe('flex items', () => {
  const col = (s: Partial<LayoutStyle>, kids: LayoutBox[]) => box('f', { display: 'flex', flexDirection: 'column', ...s }, kids);
  const row = (s: Partial<LayoutStyle>, kids: LayoutBox[]) => box('f', { display: 'flex', ...s }, kids);
  it('column: the flex base size comes from the width (the demo record)', () => {
    const m = run([col({ alignItems: 'center', justifyContent: 'center', minHeight: px(200) }, [box('a', { width: px(100), aspectRatio: r(1, 1), overflowX: 'hidden', overflowY: 'hidden' })])]);
    expect([at(m, 'f'), at(m, 'a')]).toEqual([[0, 0, 400, 200], [150, 50, 100, 100]]);
  });
  it('column: a stretched width sizes the height and takes no transferred max', () => {
    expect(at(run([col({ width: px(200) }, [box('a', { aspectRatio: r(2, 1) })])]), 'a')).toEqual([0, 0, 200, 100]);
    expect(at(run([col({ width: px(200) }, [box('a', { aspectRatio: r(2, 1), maxHeight: px(50) })])]), 'a')).toEqual([0, 0, 200, 50]);
    expect(at(run([col({ width: px(200), alignItems: 'stretch' }, [box('a', { aspectRatio: r(2, 1), maxHeight: px(50) })])]), 'a')).toEqual([0, 0, 200, 50]);
  });
  it('column: fit-content width, taller content and the automatic minimum size', () => {
    expect(at(run([col({ width: px(200), alignItems: 'center' }, [box('a', { aspectRatio: r(2, 1) }, [t('a', 'XX')])])]), 'a')).toEqual([90, 0, 20, 10]);
    expect(at(run([col({ width: px(200), alignItems: 'center' }, [box('a', { width: px(40), aspectRatio: r(4, 1) }, [t('a', 'XX XX XX')])])]), 'a')).toEqual([80, 0, 40, 30]);
    const visible = run([col({ width: px(200), height: px(50) }, [box('a', { width: px(40), aspectRatio: r(0.5, 1) }, [t('a', 'XX XX XX')]), box('b', { height: px(40), flexShrink: 0 })])]);
    expect([at(visible, 'a'), at(visible, 'b')]).toEqual([[0, 0, 40, 80], [0, 80, 200, 40]]);
    const hidden = run([col({ width: px(200), height: px(50) }, [box('a', { width: px(40), aspectRatio: r(0.5, 1), overflowX: 'hidden', overflowY: 'hidden' }, [t('a', 'XX XX XX')]), box('b', { height: px(40), flexShrink: 0 })])]);
    expect([at(hidden, 'a'), at(hidden, 'b')]).toEqual([[0, 0, 40, 10], [0, 10, 200, 40]]);
    expect(at(run([col({ width: px(200), height: px(200) }, [box('a', { width: px(40), aspectRatio: r(2, 1), flexGrow: 1 })])]), 'a')).toEqual([0, 0, 40, 200]);
  });
  it('row: the flex base size comes from a definite or stretched height', () => {
    expect(at(run([row({}, [box('a', { height: px(50), aspectRatio: r(2, 1) })])]), 'a')).toEqual([0, 0, 100, 50]);
    expect(at(run([row({}, [box('a', { aspectRatio: r(2, 1) }, [t('a', 'XX')])])]), 'a')).toEqual([0, 0, 20, 10]);
    expect(at(run([row({ height: px(60) }, [box('a', { aspectRatio: r(2, 1) }, [t('a', 'XX')])])]), 'a')).toEqual([0, 0, 120, 60]);
    expect(at(run([row({ height: px(60), alignItems: 'center' }, [box('a', { aspectRatio: r(2, 1) }, [t('a', 'XX')])])]), 'a')).toEqual([0, 25, 20, 10]);
    expect(at(run([row({ height: px(60), alignItems: 'stretch' }, [box('a', { aspectRatio: r(2, 1) }, [t('a', 'XX')])])]), 'a')).toEqual([0, 0, 120, 60]);
    expect(at(run([row({}, [box('a', { height: px(50), aspectRatio: r(2, 1), maxWidth: px(60) })])]), 'a')).toEqual([0, 0, 60, 50]);
    expect(at(run([row({ alignItems: 'flex-start' }, [box('a', { aspectRatio: r(2, 1), minHeight: px(40) })])]), 'a')).toEqual([0, 0, 80, 40]);
  });
  it('row: the cross size comes from the ratio unless the item stretches', () => {
    expect(at(run([row({ height: px(60) }, [box('a', { width: px(50), aspectRatio: r(2, 1) })])]), 'a')).toEqual([0, 0, 50, 60]);
    expect(at(run([row({ height: px(60), alignItems: 'center' }, [box('a', { width: px(50), aspectRatio: r(2, 1) })])]), 'a')).toEqual([0, 17.5, 50, 25]);
    const m = run([row({}, [box('a', { width: px(50), aspectRatio: r(2, 1) }), box('b', { width: px(10), height: px(80) })])]);
    expect([at(m, 'a'), at(m, 'b')]).toEqual([[0, 0, 50, 80], [50, 0, 10, 80]]);
  });
  it('row: the automatic minimum size keeps the transferred size', () => {
    const m = run([row({ width: px(100) }, [box('a', { height: px(50), aspectRatio: r(2, 1) }), box('b', { width: px(50), flexShrink: 0 })])]);
    expect([at(m, 'a'), at(m, 'b')]).toEqual([[0, 0, 100, 50], [100, 0, 50, 50]]);
    const n = run([row({ width: px(100) }, [box('a', { height: px(50), aspectRatio: r(2, 1) }, [t('a', 'XXXX')]), box('b', { width: px(80), flexShrink: 0 })])]);
    expect([at(n, 'a'), at(n, 'b')]).toEqual([[0, 0, 100, 50], [100, 0, 80, 50]]);
  });
});

describe('absolutely positioned boxes', () => {
  const cb = (s: Partial<LayoutStyle>, kids: LayoutBox[]) => box('p', { position: 'relative', width: px(200), ...s }, kids);
  const abs = (s: Partial<LayoutStyle>, kids: (LayoutBox | TextLeaf)[] = []) => box('a', { position: 'absolute', ...s }, kids);
  it('a percentage width gives the height (the demo record label)', () => {
    const m = run([cb({ height: px(200) }, [abs({ left: pct(50), top: pct(50), width: pct(36), aspectRatio: r(1, 1), ...edges('border', 4, 4), overflowX: 'hidden', overflowY: 'hidden' })])]);
    expect(at(m, 'a')).toEqual([100, 100, 80, 80]);
  });
  it('a height gives the width, with the automatic minimum size', () => {
    expect(at(run([cb({ height: px(200) }, [abs({ left: px(10), top: px(10), height: px(30), aspectRatio: r(2, 1) })])]), 'a')).toEqual([10, 10, 60, 30]);
    expect(at(run([cb({ height: px(200) }, [abs({ left: px(10), top: px(10), height: px(30), aspectRatio: r(1, 1) }, [t('a', 'XXXXXXXX')])])]), 'a')).toEqual([10, 10, 80, 30]);
  });
  it('the ratio beats stretching between block insets; stretched block size gives the width when the width does not stretch', () => {
    const all = { top: px(0), right: px(0), bottom: px(0), left: px(0) };
    expect(at(run([cb({ height: px(200) }, [abs({ ...all, width: px(50), aspectRatio: r(1, 1) })])]), 'a')).toEqual([0, 0, 50, 50]);
    expect(at(run([cb({ height: px(100) }, [abs({ ...all, aspectRatio: r(1, 1) })])]), 'a')).toEqual([0, 0, 200, 200]);
    expect(at(run([cb({ height: px(100) }, [abs({ top: px(0), bottom: px(10), left: px(5), aspectRatio: r(2, 1) })])]), 'a')).toEqual([5, 0, 180, 90]);
  });
  it('shrink-to-fit, with max-height transferred', () => {
    expect(at(run([cb({ height: px(100) }, [abs({ top: px(0), left: px(0), aspectRatio: r(2, 1) }, [t('a', 'XX X')])])]), 'a')).toEqual([0, 0, 40, 20]);
    expect(at(run([cb({ height: px(100) }, [abs({ top: px(0), left: px(0), aspectRatio: r(2, 1), maxHeight: px(5) }, [t('a', 'XX X')])])]), 'a')).toEqual([0, 0, 10, 5]);
  });
  it('a 16/9 box in its initial containing block with a 1px border (the demo mini video shell)', () => {
    const m = run([box('a', { position: 'absolute', left: px(16), top: px(16), width: px(360), aspectRatio: r(16, 9), ...edges('border', 1, 1), overflowX: 'hidden', overflowY: 'hidden' })]);
    expect(at(m, 'a')).toEqual([16, 16, 362, 204.5]);
  });
});

describe('intrinsic contributions', () => {
  it('a definite height gives the transferred width; otherwise the content is clamped by the transferred max', () => {
    const m = run([box('p', { position: 'absolute' }, [box('a', { height: px(20), aspectRatio: r(3, 1) })])]);
    expect([at(m, 'p'), at(m, 'a')]).toEqual([[0, 0, 60, 20], [0, 0, 60, 20]]);
    const n = run([box('p', { position: 'absolute' }, [box('a', { aspectRatio: r(3, 1), maxHeight: px(10) }, [t('a', 'XXXXXXXX')])])]);
    expect([at(n, 'p'), at(n, 'a')]).toEqual([[0, 0, 30, 10], [0, 0, 30, 10]]);
    const f = run([box('f', { display: 'flex', position: 'absolute' }, [box('a', { height: px(20), aspectRatio: r(3, 1) })])]);
    expect([at(f, 'f'), at(f, 'a')]).toEqual([[0, 0, 60, 20], [0, 0, 60, 20]]);
  });
});

describe('the validator', () => {
  it('refuses a percentage block size beside a ratio, and a ratio part that is not a positive integer', () => {
    const input = (s: Partial<LayoutStyle>) => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root: box('html', {}, [box('a', s)]) });
    for (const s of [{ height: pct(50) }, { minHeight: pct(10) }, { maxHeight: pct(10) }]) {
      const v = validateLayoutInput(input({ aspectRatio: r(1, 1), ...s }));
      expect(v.ok).toBe(false);
      expect(validateLayoutInput(input(s)).ok).toBe(true);
    }
    expect(validateLayoutInput(input({ aspectRatio: { kind: 'ratio', width: 0, height: 64 } })).ok).toBe(false);
    expect(validateLayoutInput(input({ aspectRatio: { kind: 'ratio', width: 1.5, height: 64 } })).ok).toBe(false);
  });
});
