// Blink's font metrics for a bundled face on darwin, at Chromium 145.0.7632.6 with Skia 2ab8add5 and Core Text:
// SimpleFontData::PlatformInit (platform/fonts/simple_font_data.cc), FontMetrics::AscentDescentWithHacks (font_metrics.cc),
// SkScalerContext_Mac (src/ports/SkScalerContext_mac_ct.cpp), SkFont canonicalisation (src/core/SkFont.cpp, SkStrikeSpec.cpp)
// and CSSToLengthConversionData::FontSizes (core/css/css_to_length_conversion_data.cc). Every stored float is Math.fround.
import { NO_FONT_FAULTS } from './faults.ts';
import type { FontFaults } from './faults.ts';
import type { SfntFont, SfntRefusal } from './sfnt.ts';

const f32 = Math.fround;

/** The font-face descriptors that change metrics, as Blink stores them: fractions (percent / 100) in float. */
export type MetricDescriptors = {
  readonly sizeAdjust?: number;
  readonly ascentOverride?: number;
  readonly descentOverride?: number;
  readonly lineGapOverride?: number;
};

/** A face measured at a computed font size (CSS px) and device pixel ratio (the effective zoom). */
export type FaceMetrics = {
  /** FontDescription::EffectiveFontSize at the zoomed computed size: the SkFont size, in device px. */
  readonly platformSize: number;
  /** FontMetrics ascent and descent after AscentDescentWithHacks, and the line gap (device px, float). */
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  /** FontMetrics::LineSpacing: lroundf(ascent) + lroundf(descent) + lroundf(lineGap), device px. */
  readonly lineSpacing: number;
  readonly xHeight: number;
  readonly capHeight: number;
  /** ZeroWidth: WidthForGlyph('0') as a float, no 16.16 step. */
  readonly zeroWidth: number;
  /** The CSS ex, ch and cap of 1 unit, as computed lengths in CSS px (float). */
  readonly ex: number;
  readonly ch: number;
  readonly cap: number;
  /** Whether ch is proven exact, or a caveat with its typed reason (the italic-trait face case below). */
  readonly chSupport: ChSupport;
  /** A one-line block with line-height: normal: its height and the baseline offset from its top, in LayoutUnits (1/64 device px). */
  readonly lineBoxHeightLayoutUnits: number;
  readonly baselineLayoutUnits: number;
};

/**
 * ch of a face with the italic trait is a caveat: Chrome's ch for those faces follows a Core Text italic-trait dependence that the
 * Blink 145.0.7632.6 and Skia sources do not show (packages/dragon/test/fonts/captures/metrics.json; notes/T005-txt1c-fonts.md B1).
 */
export type ChSupport = { readonly status: 'exact' } | { readonly status: 'caveat'; readonly reason: 'core-text-italic-trait-advance'; readonly evidence: string };

/** The italic trait: OS/2 fsSelection bit 0, or a nonzero post.italicAngle. */
export function hasItalicTrait(font: SfntFont): boolean {
  return ((font.os2?.fsSelection ?? 0) & 1) !== 0 || (font.post !== null && font.post.italicAngle !== 0);
}

export type MetricsResult = { readonly ok: true; readonly metrics: FaceMetrics } | { readonly ok: false; readonly refusal: SfntRefusal };

/** SkScalarRoundToScalar: floorf(x + 0.5f). */
const skRound = (x: number): number => Math.floor(f32(x + 0.5));
/** lroundf: half away from zero. */
const lroundf = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));

/** FontDescription::EffectiveFontSize: floorf(size * 100) / 100 in float (FontCacheKey precision). */
export function effectiveFontSize(size: number): number {
  return f32(Math.floor(f32(size * 100)) / 100);
}

/**
 * The Skia strike for a size: SkStrikeSpec::ShouldDrawAsPath canonicalises sizes above 256 to 64 px and scales results by
 * size / 64 (float). Core Text measures in CGFloat; Skia stores floats.
 */
function scaled(units: number, upem: number, size: number): number {
  if (size > 256) return f32(f32((units * 64) / upem) * f32(size / 64));
  return f32((units * size) / upem);
}

/**
 * A vertical metric as Core Text returns it (R5, traced in docs/research/text-spike/metric-rounding): the metric as a 16.16 fraction
 * of the em times the size, stored by Skia as a float. Measured up to 192 px; the 64 px strike above 256 px is not probed.
 */
function coreTextMetric(units: number, upem: number, size: number): number {
  const quantised = (Math.round((units * 65536) / upem) * upem) / 65536;
  if (size > 256) return scaled(quantised, upem, size);
  return f32(quantised * (size / upem));
}

/**
 * SkScalerContext_Mac::generateMetrics advance: Core Text's advance times the remaining transform sA, whose scale is
 * size * (1 / size) in float (SkScalerContextRec::computeMatrices, preScale by SkScalarInvert), applied in CGFloat.
 */
function advance(units: number, upem: number, size: number): number {
  const at = (s: number): number => f32(((units * s) / upem) * f32(f32(1 / s) * s));
  return size > 256 ? f32(at(64) * f32(size / 64)) : at(size);
}

/**
 * SkFont::getPath bounds: SkFont::setupForAsPaths draws the path at 64 px and scales it by size / 64 (float); Core Text builds the
 * path in CGFloat and Skia stores float points. The top of the path of glyph x is the x-height.
 */
function pathY(units: number, upem: number, size: number): number {
  return f32(f32((units * 64) / upem) * f32(size / 64));
}

/** Measures a face. Variable fonts are deferred to TXT1b; CFF outlines have no glyph bounds reader yet. */
export function faceMetrics(font: SfntFont, fontSize: number, dpr: number, d: MetricDescriptors = {}, faults: FontFaults = NO_FONT_FAULTS): MetricsResult {
  if (font.variable) return { ok: false, refusal: { kind: 'variable-font' } };
  const upem = font.head.unitsPerEm;
  const zoom = f32(dpr);
  const computed = f32(f32(fontSize) * zoom);
  const o = faults.overridesIgnored ? {} : d;
  // FontDescription::SizeAdjustedFontDescription: AdjustedSize = ComputedSize * size-adjust (css_font_face.cc).
  const size = effectiveFontSize(o.sizeAdjust === undefined ? computed : f32(computed * f32(o.sizeAdjust)));
  const round = faults.metricsRoundHalfDown ? (x: number): number => (x - Math.floor(x) === 0.5 ? Math.floor(x) : Math.round(x)) : skRound;
  // SkScalerContext_Mac::generateFontMetrics: hhea through Core Text; AscentDescentWithHacks overrides use platform size.
  const rawAscent = o.ascentOverride === undefined ? coreTextMetric(font.hhea.ascender, upem, size) : f32(size * f32(o.ascentOverride));
  const rawDescent = o.descentOverride === undefined ? coreTextMetric(-font.hhea.descender, upem, size) : f32(size * f32(o.descentOverride));
  const ascent = round(rawAscent);
  const descent = round(rawDescent);
  const lineGap = o.lineGapOverride === undefined ? coreTextMetric(font.hhea.lineGap, upem, size) : f32(f32(o.lineGapOverride) * size);
  const lineSpacing = lroundf(ascent) + lroundf(descent) + lroundf(lineGap);
  // x-height: on Apple, -bounds.y() of glyph x (simple_font_data.cc); cap height: OS/2 sCapHeight (SkScalerContext_mac_ct.cpp).
  const os2 = font.os2;
  const sane = (v: number | null | undefined): v is number => v !== null && v !== undefined && v > 0 && v < upem * 2;
  let xHeight: number;
  const xGlyph = font.glyphForCodePoint(0x78);
  if (faults.xHeightFromOs2 && sane(os2?.sxHeight)) xHeight = scaled(os2.sxHeight, upem, size);
  else if (xGlyph !== 0) {
    const b = font.glyphBounds(xGlyph);
    if (b !== null && 'kind' in b) return { ok: false, refusal: b };
    xHeight = b === null ? 0 : pathY(b.yMax, upem, size);
  } else if (sane(os2?.sxHeight)) xHeight = scaled(os2.sxHeight, upem, size);
  else return { ok: false, refusal: { kind: 'malformed', reason: 'no glyph x and no usable OS/2 sxHeight' } };
  let capHeight: number;
  if (faults.capHeightFromBounds) {
    const b = font.glyphBounds(font.glyphForCodePoint(0x48));
    capHeight = b === null || 'kind' in b ? 0 : pathY(b.yMax, upem, size);
  } else if (sane(os2?.sCapHeight)) capHeight = scaled(os2.sCapHeight, upem, size);
  else return { ok: false, refusal: { kind: 'malformed', reason: 'no usable OS/2 sCapHeight' } };
  // SimpleFontData::ZeroInlineSize: the advance of glyph 0, else half the font size (CSSChUnitSpecCompliantFallback).
  const zeroGlyph = font.glyphForCodePoint(0x30);
  let zeroWidth = zeroGlyph === 0 ? f32(size * 0.5) : advance(font.advance(zeroGlyph), upem, size);
  if (faults.chWith16_16) zeroWidth = f32(Math.trunc(zeroWidth * 65536) / 65536);
  // Font-metric units are pre-zoomed: value / font_zoom * zoom, then the computed value is unzoomed for CSSOM.
  const css = (v: number): number => f32(f32(f32(v / zoom) * zoom) / zoom);
  // A line box of line-height normal: FontHeight(ascent, descent) plus the leading split in LayoutUnits.
  const lu = (px: number): number => px * 64;
  const height = lu(lroundf(ascent) + lroundf(descent));
  const box = lu(lineSpacing);
  // line_utils.cc CalculateLeadingSpace: the ascent-side half leading is floored to a whole (device) pixel.
  const halfLeading = Math.floor(Math.trunc((box - height) / 2) / 64) * 64;
  return {
    ok: true,
    metrics: {
      platformSize: size,
      ascent,
      descent,
      lineGap,
      lineSpacing,
      xHeight,
      capHeight,
      zeroWidth,
      ex: css(xHeight),
      ch: css(zeroWidth),
      cap: css(capHeight),
      chSupport: hasItalicTrait(font)
        ? { status: 'caveat', reason: 'core-text-italic-trait-advance', evidence: 'packages/dragon/test/fonts/captures/metrics.json; docs/goals/milestone-2-proof/notes/T005-txt1c-fonts.md' }
        : { status: 'exact' },
      lineBoxHeightLayoutUnits: box,
      baselineLayoutUnits: lu(lroundf(ascent)) + halfLeading,
    },
  };
}
