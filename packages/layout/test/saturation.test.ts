// T129: LayoutUnit saturation in block-level inline placement and the CSS length range, pinned in raw LU against Chrome 145
// (fixture values-length-saturation, captured at DPR 1, 2, 3 and 2.625 in both directions; probe matrix in the T129 receipt).
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layout, NO_ENGINE_FAULTS, resolveEnvironment } from '../src/index.ts';
import type { GridContainerStyle, LayoutBox, LayoutRect, LayoutStyle, ReplacedLeaf, TrackSize } from '../src/index.ts';
import { box, divStyle, neutralEnvironment, px, text } from './helpers.ts';

const INT_MAX = 2147483647;
const auto = { kind: 'auto' } as const;

function absX(root: LayoutBox, id: string, devicePixelRatio = 1): number {
  const r = layout({ viewport: { width: 400, height: 300 }, devicePixelRatio, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return (absoluteRects(r.boxes).get(id) as LayoutRect).x;
}

function rect(root: LayoutBox, id: string, devicePixelRatio = 1): LayoutRect {
  const r = layout({ viewport: { width: 400, height: 300 }, devicePixelRatio, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return r.boxes.find((b) => b.id === id) as LayoutRect;
}

/** The fixture's frame: body margin 0 21px 0 8px (physical left 21px), a 300px wide parent, and a 10px wide child. */
function frame(direction: 'ltr' | 'rtl', kid: Partial<LayoutStyle>, parent: Partial<LayoutStyle> = {}): LayoutBox {
  const d = { direction };
  return box('html', d, [box('body', { ...d, marginLeft: px(21), marginRight: px(8) }, [
    box('p', { ...d, width: px(300), height: px(10), ...parent }, [box('k', { ...d, width: px(10), height: px(10), ...kid })]),
  ])]);
}

describe('rtl in-flow block child: Blink adds the over-constrained end margin back with saturating LayoutUnit sums', () => {
  // ComputeChildData: additional = ((available - text_align) - inline_size) - InlineSum(); line offset = ((Pb + line-left
  // border-padding) + additional) + margin-left. Unsaturated this is CSS2 §10.3.3 (margin-left ignored); saturated it is not.
  it('margin-left -33554430px (the CSS length minimum) lands at 127 LU, Chrome x = 1.984375 px, not 382 px', () => {
    expect(absX(frame('rtl', { marginLeft: px(-33554430) }), 'k')).toBe(127);
    // Pb = 92 px: 5888 + (18560 - (-2147483520)) saturates to INT_MAX, then + margin-left.
    expect(INT_MAX - 33554430 * 64).toBe(127);
  });

  it('the saturation boundary is exact: -33554049px is ignored (382 px), -33554050px lands one LU left (381.984375 px)', () => {
    expect(absX(frame('rtl', { marginLeft: px(-33554049) }), 'k')).toBe(382 * 64);
    expect(absX(frame('rtl', { marginLeft: px(-33554050) }), 'k')).toBe(382 * 64 - 1);
  });

  it('the parent offset and the parent border and padding enter the sum as Blink orders it', () => {
    expect(absX(frame('rtl', { marginLeft: px(-33554430) }, { marginRight: px(30) }), 'k')).toBe(127);
    expect(absX(frame('rtl', { marginLeft: px(-33554430) }, { marginRight: px(5000) }), 'k')).toBe(-313985);
    const framed = { paddingLeft: px(7), paddingRight: px(13), borderLeftWidth: px(3), borderRightWidth: px(5) };
    expect(absX(frame('rtl', { marginLeft: px(-33554430) }, framed), 'k')).toBe(127);
  });

  it('a new formatting context is placed in its layout opportunity, where margin-left stays ignored (382 px)', () => {
    expect(absX(frame('rtl', { marginLeft: px(-33554430), overflowX: 'hidden', overflowY: 'hidden' }), 'k')).toBe(382 * 64);
    expect(absX(frame('rtl', { marginLeft: px(-33554430), display: 'flex' }), 'k')).toBe(382 * 64);
    expect(absX(frame('rtl', { marginLeft: px(-33554430) }, { display: 'flex' }), 'k')).toBe(382 * 64);
  });

  it('an auto start margin with a 33554429px end margin stays at the inline start (382 px)', () => {
    expect(absX(frame('rtl', { marginRight: auto, marginLeft: px(33554429) }), 'k')).toBe(382 * 64);
  });

  it('left-to-right the start margin is the line-left margin and no sum saturates', () => {
    expect(absX(frame('ltr', { marginRight: px(-33554430) }), 'k')).toBe(21 * 64);
    expect(absX(frame('ltr', { marginRight: px(-33554430) }, { marginLeft: px(5000) }), 'k')).toBe(5021 * 64);
  });
});

describe('px lengths are clamped to the CSS length range after zoom (ClampToCSSLengthRange), as calc() results are', () => {
  it('-1e9px behaves as -33554430px; unclamped it would saturate to INT_MIN and land at -0.015625 px', () => {
    expect(absX(frame('rtl', { marginLeft: px(-1e9) }), 'k')).toBe(127);
  });

  it('Chrome: width 1e9px is 33554428 px (float(33554429)), at DPR 1 and as zoomed px at DPR 2', () => {
    const root = (w: number) => box('html', {}, [box('k', { width: px(w), height: px(5) })]);
    expect(rect(root(1e9), 'k').width).toBe(33554428 * 64);
    expect(rect(root(1e9), 'k', 2).width).toBe(33554428 * 64);
    expect(rect(root(2e7), 'k', 2).width).toBe(33554428 * 64);
    expect(rect(root(2e7), 'k').width).toBe(2e7 * 64);
  });

  it('margins, padding and insets clamp the same way', () => {
    expect(rect(box('html', {}, [box('k', { marginLeft: px(1e9), width: px(0), height: px(5) })]), 'k').x).toBe(33554428 * 64);
    expect(rect(box('html', {}, [box('k', { paddingLeft: px(1e9), height: px(5) })]), 'k').width).toBe(33554428 * 64);
    expect(rect(box('html', {}, [box('k', { position: 'relative', left: px(1e9), height: px(5) })]), 'k').x).toBe(33554428 * 64);
  });

  it('a text run\'s px line height clamps the same way, at DPR 1 and zoomed (Macroscope 4169406044)', () => {
    const root = (lh: number) => box('html', {}, [box('k', {}, [text('t', 'X', { lineHeight: px(lh) })])]);
    for (const dpr of [1, 2]) {
      expect(rect(root(1e9), 'k', dpr).height).toBe(rect(root(33554429), 'k', dpr).height);
      expect(rect(root(1e9), 'k', dpr).height).toBeLessThan(INT_MAX);
    }
  });

  it('a replaced leaf\'s px object-position clamps the same way, at DPR 1 and zoomed (Macroscope 4169406044)', () => {
    const img = (x: number, y: number): ReplacedLeaf => ({
      kind: 'replaced', id: 'i', style: { ...divStyle, display: 'block' }, natural: { kind: 'image', width: 10, height: 10 },
      defaultWidth: 300, defaultHeight: 150, objectFit: 'none', objectPositionX: px(x), objectPositionY: px(y),
    });
    for (const dpr of [1, 2]) {
      const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: dpr, ...neutralEnvironment({ width: 400, height: 300 }), root: box('html', {}, [img(1e9, -1e9) as unknown as LayoutBox]) };
      const leaf = resolveEnvironment(input, NO_ENGINE_FAULTS, ahemMeasurer).root.children[0] as ReplacedLeaf;
      expect([leaf.objectPositionX, leaf.objectPositionY]).toEqual([px(33554429), px(-33554430)]);
    }
  });

  it('grid track px sizes and fit-content() px limits clamp the same way, at DPR 1 and zoomed (review of #197)', () => {
    const big: TrackSize = { kind: 'breadth', breadth: px(1e9) };
    const g: GridContainerStyle = {
      templateColumns: [{ count: 1, sizes: [big, { kind: 'minmax', min: px(0), max: px(1e9) }] }], templateRows: [{ count: 1, sizes: [{ kind: 'fit-content', limit: px(1e9) }] }],
      autoColumns: [big], autoRows: [{ kind: 'breadth', breadth: { kind: 'auto' } }], explicitColumnCount: 2, explicitRowCount: 1, autoRepeatColumns: null, autoRepeatRows: null, autoFlow: 'row', dense: false, justifyItems: 'normal',
    };
    for (const dpr of [1, 2]) {
      const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: dpr, ...neutralEnvironment({ width: 400, height: 300 }), root: box('html', {}, [box('g', { display: 'grid', grid: g })]) };
      const got = (resolveEnvironment(input, NO_ENGINE_FAULTS, ahemMeasurer).root.children[0] as LayoutBox).style.grid as GridContainerStyle;
      const max: TrackSize = { kind: 'breadth', breadth: px(33554429) };
      expect(got.templateColumns[0]?.sizes).toEqual([max, { kind: 'minmax', min: px(0), max: px(33554429) }]);
      expect(got.templateRows[0]?.sizes).toEqual([{ kind: 'fit-content', limit: px(33554429) }]);
      expect(got.autoColumns).toEqual([max]);
    }
  });
});

describe('without saturation the Blink-ordered placement equals the closed form the engine used before T129', () => {
  it('random block children in both directions, with and without auto margins and new formatting contexts', () => {
    let seed = 129;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const len = (): number => Math.round((next() - 0.5) * 2000 * 64) / 64;
    for (let i = 0; i < 2000; i++) {
      const direction = next() < 0.5 ? 'ltr' : 'rtl';
      const ml = next() < 0.2 ? null : len();
      const mr = next() < 0.2 ? null : len();
      const width = next() < 0.3 ? null : Math.abs(len());
      const fc = next() < 0.3;
      const kid: Partial<LayoutStyle> = {
        marginLeft: ml === null ? auto : px(ml),
        marginRight: mr === null ? auto : px(mr),
        width: width === null ? auto : px(width),
        ...(fc ? { overflowX: 'hidden', overflowY: 'hidden' } : {}),
      };
      const root = box('html', { direction }, [box('p', { direction, width: px(300), paddingLeft: px(4), paddingRight: px(9) }, [box('k', { direction, height: px(1), ...kid })])]);
      const k = rect(root, 'k');
      const cb = 300 * 64;
      const start = (direction === 'rtl' ? mr : ml) ?? 0;
      const end = (direction === 'rtl' ? ml : mr) ?? 0;
      const w = width === null ? Math.max(0, cb - start * 64 - end * 64) : width * 64;
      expect(k.width, `case ${i}`).toBe(Math.trunc(w));
      const free = cb - (k.width + Math.trunc(start * 64) + Math.trunc(end * 64));
      const startAuto = (direction === 'rtl' ? mr : ml) === null;
      const endAuto = (direction === 'rtl' ? ml : mr) === null;
      const usedStart = startAuto && endAuto ? Math.max(0, Math.trunc(free / 2)) : startAuto ? Math.max(0, free) : Math.trunc(start * 64);
      const x = direction === 'rtl' ? 4 * 64 + cb - usedStart - k.width : 4 * 64 + usedStart;
      expect(k.x, `case ${i}`).toBe(x);
    }
  });
});
