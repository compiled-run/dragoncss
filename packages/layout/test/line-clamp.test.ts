// TXT2-g: -webkit-line-clamp in the engine (inline.ts clampsLine and clampedLinesHeight, block.ts nestedClamp), a port of Blink's
// legacy line clamp (block_layout_algorithm.cc BlockLineClampData, inline_layout_algorithm.cc GetLineClampState). Chrome agreement
// is proven by the line-clamp fixture group (packages/parity); these cases pin the port's decisions in 10px Ahem.
import { describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutBox, LayoutResult, LayoutStyle } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, clampedInput, fromCssPx, layoutWithFaults, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines } from '../src/index.ts';
import { ahemFont, box, neutralEnvironment, px, span, text } from './helpers.ts';

const G = 640;
const CLAMP = (n: number): Partial<LayoutStyle> => ({ width: px(55), overflowX: 'hidden', overflowY: 'hidden', lineClamp: n });
const t = (id: string, value: string, size = 10) => text(id, value, { font: ahemFont(size) });
const ctx = (faults: EngineFaults = NO_ENGINE_FAULTS) => ({ measurer: ahemMeasurer, devicePixelRatio: 1, faults, gridFaults: NO_GRID_FAULTS });

function run(root: LayoutBox, faults: EngineFaults = NO_ENGINE_FAULTS): LayoutResult {
  return layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer, faults);
}

function height(r: LayoutResult, id: string): number | undefined {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return absoluteRects(r.boxes).get(id)?.height;
}

describe('TXT2-g: one inline formatting context', () => {
  // Four lines of 50px: "XX XX" at a 55px width.
  const four = 'XX XX XX XX XX XX XX XX';

  it('ends the content after line N and puts the ellipsis after line N, which fits', () => {
    const b = box('a', CLAMP(2), [t('t', four)]);
    const lines = placeLines(ctx(), b, fromCssPx(55));
    expect(lines.map((l) => l.ellipsis === null)).toEqual([true, false, true, true]);
    // Line 2 is "XX XX" (50px): with the 10px ellipsis it overflows 55px, so it is cut after "XX X" (line_truncator.cc TruncateLine).
    expect(lines[1]?.ellipsis).toMatchObject({ text: '…', x: 4 * G, width: G });
    expect(lines[1]?.pieces[0]).toMatchObject({ truncated: true, paintEnd: 10, truncatedWidth: 4 * G });
    expect(height(run(box('root', {}, [b])), 'a')).toBe(20 * 64);
  });

  it('puts the ellipsis right after a line N that fits with it, without cutting the text', () => {
    const b = box('a', { ...CLAMP(1), width: px(100) }, [t('t', 'XXX XXXXXXXX')]);
    const [first] = placeLines(ctx(), b, fromCssPx(100));
    expect(first?.ellipsis).toMatchObject({ x: 3 * G, width: G });
    expect(first?.pieces[0]).toMatchObject({ truncated: false, paintEnd: 3 });
  });

  it('leaves exactly N lines, and fewer, alone (Blink relays out without the clamp)', () => {
    for (const n of [4, 5]) {
      const b = box('a', CLAMP(n), [t('t', four)]);
      expect(placeLines(ctx(), b, fromCssPx(55)).every((l) => l.ellipsis === null), `${n}`).toBe(true);
      expect(height(run(box('root', {}, [b])), 'a')).toBe(40 * 64);
    }
  });

  it('adds the padding after line N', () => {
    const b = box('a', { ...CLAMP(2), paddingTop: px(3), paddingBottom: px(3) }, [t('t', four)]);
    expect(height(run(box('root', {}, [b])), 'a')).toBe(26 * 64);
  });

  it('catches the planted faults', () => {
    const b = box('a', CLAMP(2), [t('t', four)]);
    expect(height(run(box('root', {}, [b]), { ...NO_ENGINE_FAULTS, clampHeightIncludesHiddenLines: true }), 'a')).toBe(40 * 64);
    const fits = box('a', { ...CLAMP(1), width: px(100) }, [t('t', 'XXX XXXXXXXX')]);
    expect(placeLines(ctx({ ...NO_ENGINE_FAULTS, clampEllipsisMissingWhenLineFits: true }), fits, fromCssPx(100))[0]?.ellipsis).toBeNull();
    const exact = box('a', CLAMP(4), [t('t', four)]);
    expect(placeLines(ctx({ ...NO_ENGINE_FAULTS, clampEllipsisOnExactLastLine: true }), exact, fromCssPx(55))[3]?.ellipsis).not.toBeNull();
  });

  it('takes the ellipsis in the block font after a smaller span', () => {
    const b = box('a', CLAMP(1), [span('s', [t('t', 'XXXX XXXX XXXX XXXX', 5)], { font: ahemFont(5) })], { font: ahemFont(10), lineHeight: { kind: 'normal' } });
    const [first] = placeLines(ctx(), b, fromCssPx(55));
    expect(first?.ellipsis).toMatchObject({ width: G });
  });

  it('refuses rtl', () => {
    const r = run(box('root', {}, [box('a', { ...CLAMP(2), direction: 'rtl' }, [t('t', four)])]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('line-clamp');
  });
});

describe('TXT2-g: block children, one level down', () => {
  const block = (id: string, value: string): LayoutBox => box(id, {}, [t(`${id}t`, value)]);

  it('counts lines through the children and clamps in the child that holds line N', () => {
    const root = box('root', {}, [box('a', CLAMP(3), [block('b1', 'XX XX'), block('b2', 'XX XX XX XX XX XX'), block('b3', 'XX')])]);
    const r = run(root);
    // b1 has 1 line; the clamp point is line 2 of b2, whose own content ends there; a ends at b2's clamped bottom.
    expect(height(r, 'b1')).toBe(10 * 64);
    expect(height(r, 'b2')).toBe(20 * 64);
    expect(height(r, 'a')).toBe(30 * 64);
  });

  it('clamps at the bottom of the child whose last line is line N when a sibling follows, and not at all when nothing does', () => {
    const after = box('a', CLAMP(2), [block('b1', 'XX'), block('b2', 'XX'), block('b3', 'XX')]);
    const exact = box('a', CLAMP(2), [block('b1', 'XX'), block('b2', 'XX')]);
    expect(height(run(box('root', {}, [after])), 'a')).toBe(20 * 64);
    expect(height(run(box('root', {}, [exact])), 'a')).toBe(20 * 64);
    expect(height(run(box('root', {}, [box('a', CLAMP(3), [block('b1', 'XX'), block('b2', 'XX')])])), 'a')).toBe(20 * 64);
  });

  it('a nested clamp (lineClamp -N) puts the ellipsis on line N even when it is the last', () => {
    const [last] = placeLines(ctx(), box('b2', { lineClamp: -1 }, [t('t', 'XX')]), fromCssPx(55));
    expect(last?.ellipsis).toMatchObject({ x: 2 * G });
    const [own] = placeLines(ctx(), box('b2', { lineClamp: 1 }, [t('t', 'XX')]), fromCssPx(55));
    expect(own?.ellipsis).toBeNull();
  });

  it('clampedInput gives a host the children as the layout clamped them', () => {
    const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root: box('root', {}, [box('a', CLAMP(3), [block('b1', 'XX XX'), block('b2', 'XX XX XX XX XX XX'), block('b3', 'XX')])]) };
    const r = layoutWithFaults(input, ahemMeasurer, NO_ENGINE_FAULTS);
    if (r.kind !== 'ok') throw new Error('refused');
    const a = clampedInput(input, r.boxes, ahemMeasurer).root.children[0] as LayoutBox;
    expect(a.children.map((k) => (k.kind === 'box' ? k.style.lineClamp : null))).toEqual([0, -2, 0]);
  });

  it('refuses a child that is not a block of inline content', () => {
    const r = run(box('root', {}, [box('a', CLAMP(2), [box('b', {}, [block('c', 'XX XX XX')])])]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('line-clamp');
  });
});
