// Text decoration geometry as Chrome 145 paints it (TDEC-a, notes/T148J-tdec.md), ported from Blink 145.0.7632.6 (BSD):
// text_decoration_info.cc ComputeDecorationThickness (74-102), ComputeThickness (453-464), SetLineThroughLineData (395-400),
// OffsetFromDecoratingBox (319-330); text_decoration_offset.cc ComputeUnderlineOffsetAuto (16-33) and ComputeUnderlineOffsetForUnder
// with TextTop (49-81; simple_font_data.cc:421-424); decoration_line_painter.cc SnapYAxis, RoundDownThickness and DrawLineAsRect
// (15-27, 75-93); text_fragment_painter.cc paint order (550-557); text_painter.cc skip-ink band (555-563). Every length is in zoomed
// (device) px. Skia 2ab8add5 fills the snapped rect with anti-aliased x edges: SkScan_Antihair.cpp antifillrect's 8-bit partial
// coverage, blended by the ARGB32 blitter. Reference only: no engine root reaches it until TDEC-b.
import { floorOf, roundOf } from './rt-easing.ts';

/** Planted faults; the decoration capture against Chrome must catch each one. */
export type DecorationFaults = {
  /** auto thickness reads the font's underline thickness instead of computed size / 10. */
  readonly autoThicknessFromFont: boolean;
  /** The one-pixel-or-more gap is added when text-underline-offset is a length too. */
  readonly gapWithFixedOffset: boolean;
  /** text-underline-offset is not roundf'd. */
  readonly offsetNotRounded: boolean;
  /** The rect's y snaps by floor(y) instead of floor(y + 0.5). */
  readonly snapFloorNotHalf: boolean;
  /** The drawn height is round(thickness) instead of floor(thickness). */
  readonly thicknessRoundedNotFloored: boolean;
  /** line-through is placed from the baseline instead of the text top. */
  readonly lineThroughFromBaseline: boolean;
  /** The text's own font metrics are used instead of the decorating box's. */
  readonly decoratingBoxFontIgnored: boolean;
  /** Underlines and overlines are painted after the text instead of before it. */
  readonly underlineAfterText: boolean;
};

export const NO_DECORATION_FAULTS: DecorationFaults = {
  autoThicknessFromFont: false, gapWithFixedOffset: false, offsetNotRounded: false, snapFloorNotHalf: false,
  thicknessRoundedNotFloored: false, lineThroughFromBaseline: false, decoratingBoxFontIgnored: false, underlineAfterText: false,
};

/** C roundf: half away from zero. */
function roundf(v: number): number {
  return v < 0 ? -roundOf(-v) : roundOf(v);
}

/** text-decoration-thickness, or text-underline-offset: auto, a length in zoomed px, or a percentage of the font size. */
export type DecorationLength = { readonly kind: 'auto' } | { readonly kind: 'px'; readonly value: number } | { readonly kind: 'percent'; readonly value: number };

/** The decorating box's font metrics in zoomed px: FloatAscent, the integer Ascent and the computed font size. */
export type DecorationFont = { readonly floatAscent: number; readonly ascent: number; readonly size: number; readonly underlineThickness: number };

/** ComputeDecorationThickness and ComputeThickness: auto is size / 10, a length roundf'd, never below 1 (non-SVG text). */
export function decorationThickness(thickness: DecorationLength, font: DecorationFont, faults: DecorationFaults): number {
  let t = font.size / 10;
  if (thickness.kind === 'auto' && faults.autoThicknessFromFont) t = font.underlineThickness;
  if (thickness.kind === 'px') t = roundf(thickness.value);
  if (thickness.kind === 'percent') t = roundf((thickness.value * font.size) / 100);
  return t < 1 ? 1 : t;
}

/** StyleUnderlineOffsetToPixels: 0 for auto. */
function offsetPixels(offset: DecorationLength, size: number): number {
  if (offset.kind === 'px') return offset.value;
  if (offset.kind === 'percent') return (offset.value * size) / 100;
  return 0;
}

/** ComputeUnderlineOffsetAuto: integer Ascent, plus max(1, ceil(t / 2)) only when the offset is auto, plus roundf(offset). */
export function underlineOffset(offset: DecorationLength, font: DecorationFont, thickness: number, faults: DecorationFaults): number {
  const auto = offset.kind === 'auto';
  const half = -floorOf(-(thickness / 2));
  const gap = auto || faults.gapWithFixedOffset ? (half > 1 ? half : 1) : 0;
  const px = offsetPixels(offset, font.size);
  return font.ascent + gap + (faults.offsetNotRounded ? px : roundf(px));
}

/** ComputeUnderlineOffsetForUnder with TextTop: floor(LayoutUnit(FloatAscent) - Ascent) - floor(t). */
export function overlineOffset(font: DecorationFont, thickness: number): number {
  const ascentLayoutUnit = roundOf(font.floatAscent * 64) / 64;
  return floorOf(ascentLayoutUnit - font.ascent) - floorOf(thickness);
}

/** SetLineThroughLineData: 2 * FloatAscent / 3 - t / 2 below the text top. */
export function lineThroughOffset(font: DecorationFont, thickness: number): number {
  return (2 * font.floatAscent) / 3 - thickness / 2;
}

/** One decoration's lines on one text fragment, in zoomed px. */
export type DecorationInput = {
  readonly lines: readonly ('underline' | 'overline' | 'line-through')[];
  readonly thickness: DecorationLength;
  readonly underlineOffset: DecorationLength;
  /** The decorating box's font, and the text fragment's own (used under the decoratingBoxFontIgnored plant). */
  readonly font: DecorationFont;
  readonly textFont: DecorationFont;
  /** The text fragment's left, width and top (local_origin_), and the decorating box's content top, in zoomed px. */
  readonly left: number;
  readonly width: number;
  readonly textTop: number;
  readonly decoratingTop: number;
};

/** A snapped decoration rect: whole device rows [top, top + height), and x from left to right with anti-aliased ends. */
export type DecorationRect = {
  readonly line: 'underline' | 'overline' | 'line-through';
  /** The unsnapped line rect (DecorationLinePainter::Bounds), for the skip-ink band. */
  readonly y: number;
  readonly thickness: number;
  readonly top: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  /** text_fragment_painter.cc:550-557: under and overlines paint before the text, line-through after it. */
  readonly beforeText: boolean;
};

/** SnapYAxis and RoundDownThickness. */
function snap(line: DecorationRect['line'], y: number, t: number, input: DecorationInput, faults: DecorationFaults): DecorationRect {
  const top = faults.snapFloorNotHalf ? floorOf(y) : floorOf(y + 0.5);
  const down = faults.thicknessRoundedNotFloored ? roundOf(t) : floorOf(t);
  const before = line !== 'line-through';
  return { line, y, thickness: t, top, height: down > 1 ? down : 1, left: input.left, right: input.left + input.width, beforeText: faults.underlineAfterText ? !before : before };
}

/** The rects one applied decoration paints on one text fragment, in Blink's order: underline, overline, line-through. */
/** Whether lines holds line. */
function has(lines: readonly DecorationRect['line'][], line: DecorationRect['line']): boolean {
  for (const l of lines) if (l === line) return true;
  return false;
}

export function decorationRects(input: DecorationInput, faults: DecorationFaults): DecorationRect[] {
  const font = faults.decoratingBoxFontIgnored ? input.textFont : input.font;
  const t = decorationThickness(input.thickness, font, faults);
  const out: DecorationRect[] = [];
  if (has(input.lines, 'underline')) {
    // The offset is for the decorating box; OffsetFromDecoratingBox converts it to the text fragment.
    const fromBox = faults.decoratingBoxFontIgnored ? 0 : input.decoratingTop - input.textTop;
    out.push(snap('underline', input.textTop + underlineOffset(input.underlineOffset, font, t, faults) + fromBox, t, input, faults));
  }
  if (has(input.lines, 'overline')) out.push(snap('overline', input.textTop + overlineOffset(font, t), t, input, faults));
  if (has(input.lines, 'line-through')) {
    const base = faults.lineThroughFromBaseline ? input.textTop + font.floatAscent : input.textTop;
    out.push(snap('line-through', base + lineThroughOffset(font, t), t, input, faults));
  }
  return out;
}

/**
 * text_painter.cc:555-563: skip-ink clips the band of an under or overline, its Bounds inset by 0.5 px vertically, wherever a glyph's
 * ink crosses it. Conservative proof: when every glyph's control-point y extent lies at least 1/64 px outside the band, nothing is
 * clipped. Returns true when that holds; otherwise the text needs the intercepts (TDEC-d).
 */
/** A glyph's control-point y extent in zoomed px, top above bottom. */
export type GlyphExtent = { readonly top: number; readonly bottom: number };

export function skipInkClear(rect: DecorationRect, glyphs: readonly GlyphExtent[]): boolean {
  const bandTop = rect.y + 0.5;
  const bandBottom = rect.y + rect.thickness - 0.5;
  const margin = 1 / 64;
  for (const g of glyphs) {
    if (g.bottom > bandTop - margin && g.top < bandBottom + margin) return false;
  }
  return true;
}


/**
 * SkScan_Antihair.cpp antifilldot8 over a snapped rect (whole rows) in FDot8 (24.8): the 8-bit alpha the blitter gets for pixel
 * column x, or 256 for a fully covered column. A one-row rect goes through do_scanline, which scales each partial column by
 * SkAlphaMul(255, coverage); a taller one blits each partial column by blitV with the coverage itself (256 - L & 0xFF on the left,
 * R & 0xFF on the right, R - L - 1 when one column holds both edges).
 */
export function columnAlpha(x: number, left: number, right: number, rows: number): number {
  const l = floorOf(floorOf(left * 65536) / 256);
  const r = floorOf(floorOf(right * 65536) / 256);
  const x0 = x * 256;
  const x1 = x0 + 256;
  if (r <= x0 || l >= x1 || r <= l) return 0;
  if (l <= x0 && r >= x1) return 256;
  const single = rows === 1;
  if (floorOf(l / 256) === floorOf((r - 1) / 256)) return single ? floorOf((255 * (r - l)) / 256) : r - l - 1;
  const c = l > x0 ? 256 - (l - x0) : r - x0;
  return single ? floorOf((255 * c) / 256) : c;
}

/** An 8-bit straight-alpha colour. */
export type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

/** SkMulDiv255Round. */
function mulDiv255(c: number, a: number): number {
  const p = c * a + 128;
  return floorOf((p + floorOf(p / 256)) / 256);
}

/**
 * The SkARGB32 blitters' src-over of a colour over an opaque pixel: the colour premultiplied (SkPreMultiplyARGB); a partial alpha
 * scales it by SkAlpha255To256(alpha) (SkAlphaMulQ); the destination is scaled by SkAlpha255To256(255 - the result's alpha).
 */
export function blendOver(dst: Rgba, src: Rgba, alpha: number): Rgba {
  let r = mulDiv255(src.r, src.a);
  let g = mulDiv255(src.g, src.a);
  let b = mulDiv255(src.b, src.a);
  let a = src.a;
  if (alpha < 256) {
    const scale = alpha + 1;
    r = floorOf((r * scale) / 256);
    g = floorOf((g * scale) / 256);
    b = floorOf((b * scale) / 256);
    a = floorOf((a * scale) / 256);
  }
  const dstScale = 256 - a;
  return { r: r + floorOf((dst.r * dstScale) / 256), g: g + floorOf((dst.g * dstScale) / 256), b: b + floorOf((dst.b * dstScale) / 256), a: 255 };
}
