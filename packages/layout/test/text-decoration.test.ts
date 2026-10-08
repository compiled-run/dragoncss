// TDEC-a geometry (src/text-decoration.ts) in zoomed px: Blink's thickness, offsets and snapping, Skia's antifilldot8 coverage and
// the ARGB32 blend, and the conservative skip-ink proof. The Chrome comparison is packages/parity/test/text-decoration.test.ts;
// the values here are cases it measured.
import { describe, expect, it } from 'vitest';
import { blendOver, columnAlpha, decorationRects, decorationThickness, lineThroughOffset, NO_DECORATION_FAULTS, overlineOffset, skipInkClear, underlineOffset } from '../src/text-decoration.ts';
import type { DecorationFont, DecorationInput } from '../src/text-decoration.ts';

const LATO16: DecorationFont = { floatAscent: 16, ascent: 16, size: 16, underlineThickness: 1.6 };
const F = NO_DECORATION_FAULTS;

describe('thickness and offsets (text_decoration_info.cc, text_decoration_offset.cc)', () => {
  it('auto thickness is size / 10, a length roundf, a percentage of the size roundf, never below 1', () => {
    expect(decorationThickness({ kind: 'auto' }, LATO16, F)).toBeCloseTo(1.6, 6);
    expect(decorationThickness({ kind: 'px', value: 7.875 }, LATO16, F)).toBe(8);
    expect(decorationThickness({ kind: 'px', value: 2.5 }, LATO16, F)).toBe(3);
    expect(decorationThickness({ kind: 'percent', value: 25 }, LATO16, F)).toBe(4);
    expect(decorationThickness({ kind: 'px', value: -1 }, LATO16, F)).toBe(1);
  });
  it('the underline sits Ascent + a gap of max(1, ceil(t / 2)) when the offset is auto, else Ascent + roundf(offset)', () => {
    expect(underlineOffset({ kind: 'auto' }, LATO16, 3, F)).toBe(18);
    expect(underlineOffset({ kind: 'auto' }, LATO16, 1.6, F)).toBe(17);
    expect(underlineOffset({ kind: 'px', value: 3.2 }, LATO16, 1.6, F)).toBe(19);
    expect(underlineOffset({ kind: 'px', value: -2.5 }, LATO16, 1.6, F)).toBe(13);
    expect(underlineOffset({ kind: 'percent', value: 20 }, LATO16, 1.6, F)).toBe(19);
  });
  it('the overline is floor(FloatAscent in LayoutUnit - Ascent) - floor(t) above the text top; line-through 2 FloatAscent / 3 - t / 2 below it', () => {
    expect(overlineOffset(LATO16, 3)).toBe(-3);
    expect(overlineOffset({ ...LATO16, floatAscent: 15.8 }, 1.6)).toBe(-2);
    expect(lineThroughOffset(LATO16, 2)).toBeCloseTo(32 / 3 - 1, 9);
  });
});

describe('the snapped rects (decoration_line_painter.cc)', () => {
  const input: DecorationInput = { lines: ['line-through', 'overline', 'underline'], thickness: { kind: 'px', value: 3 }, underlineOffset: { kind: 'auto' }, font: LATO16, textFont: LATO16, left: 10.296875, width: 85.921875, textTop: 5.1875, decoratingTop: 5.1875 };
  it('paints underline, overline then line-through; y snaps to floor(y + 0.5) and the height to floor(t); under and overlines go before the text', () => {
    expect(decorationRects(input, F).map((r) => [r.line, r.top, r.height, r.beforeText])).toEqual([['underline', 23, 3, true], ['overline', 2, 3, true], ['line-through', 14, 3, false]]);
    expect(decorationRects({ ...input, thickness: { kind: 'auto' } }, F).map((r) => r.height)).toEqual([1, 1, 1]);
  });
});

describe('Skia antifilldot8 and the ARGB32 blend, as Chrome rasters a decoration rect', () => {
  it('a one-row rect scales a partial column by SkAlphaMul(255, coverage); a taller one blits the coverage itself', () => {
    expect(columnAlpha(136, 0, 136.140625, 1)).toBe(35);
    expect(columnAlpha(136, 0, 136.140625, 3)).toBe(36);
    expect(columnAlpha(10, 10.296875, 96.21875, 3)).toBe(180);
    expect(columnAlpha(50, 10.296875, 96.21875, 3)).toBe(256);
    expect(columnAlpha(97, 10.296875, 96.21875, 3)).toBe(0);
  });
  it('blends a premultiplied colour scaled by alpha + 1 over white as Chrome does', () => {
    const white = { r: 255, g: 255, b: 255, a: 255 };
    const black = { r: 0, g: 0, b: 0, a: 255 };
    expect(blendOver(white, black, 35).g).toBe(220);
    expect(blendOver(white, black, 72).g).toBe(183);
    const red = { r: 255, g: 0, b: 0, a: 153 };
    expect(blendOver(white, red, 256)).toEqual({ r: 255, g: 102, b: 102, a: 255 });
    expect(blendOver(white, red, 56)).toEqual({ r: 255, g: 221, b: 221, a: 255 });
  });
});

describe('the skip-ink bounds proof (text_painter.cc:555-563)', () => {
  it('passes only when every glyph extent clears the band, the line inset by 0.5 px, by at least 1/64 px', () => {
    const [r] = decorationRects({ lines: ['underline'], thickness: { kind: 'auto' }, underlineOffset: { kind: 'px', value: 3.2 }, font: LATO16, textFont: LATO16, left: 0, width: 50, textTop: 0, decoratingTop: 0 }, F);
    if (r === undefined) throw new Error('no rect');
    expect(skipInkClear(r, [{ top: 4, bottom: 18.27 }])).toBe(true);
    expect(skipInkClear(r, [{ top: 4, bottom: 19.6 }])).toBe(false);
    expect(skipInkClear(r, [{ top: 20.0, bottom: 25 }])).toBe(false);
    expect(skipInkClear(r, [{ top: 20.2, bottom: 25 }])).toBe(true);
  });
});
