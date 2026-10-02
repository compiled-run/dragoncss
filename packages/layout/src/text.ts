// Text measurement is injected. The Ahem measurer is pure: it models the WPT Ahem v1.50 metrics without reading the font.
import type { TextFont } from './input.ts';
import type { LU } from './units.ts';
import { cachedRangeWidth, fontMetricPx, glyphBoundsMetricPx, platformFontSize, roundFontMetricHalfUpToWholePx, roundFontMetricToWholePx, textAdvanceAt, ZERO } from './units.ts';

export type FontMetrics = { readonly ascent: LU; readonly descent: LU; readonly lineGap: LU };

/** The float font metrics ex, cap and ch read (css-values-4 §6.1.1), in px at a font instance size. */
export type FontLengths = { readonly xHeight: number; readonly capHeight: number; readonly zeroWidth: number };

/** The advance of one run of text on one line. */
export type TextMeasure = { readonly width: LU };

export type MeasureResult = { readonly ok: true; readonly measure: TextMeasure } | { readonly ok: false; readonly reason: string };

export interface TextMeasurer {
  metrics(font: TextFont): FontMetrics;
  measure(text: string, font: TextFont): MeasureResult;
  /**
   * R4: the width of code points [start, end) of text shaped as one text item, as Blink's fast min-content path measures a word
   * (ShapeResult::CachedWidth: the difference of the item's cached character positions).
   */
  measureRange(text: string, start: number, end: number, font: TextFont): MeasureResult;
  /** The float x-height, cap height and advance of 0 of the font instance (fontMetricLengths). */
  lengths(font: TextFont): FontLengths;
}

const ZWSP = 0x200b;
const AHEM_UNITS_PER_EM = 1000;
const AHEM_ASCENT = 800;
const AHEM_DESCENT = 200;
const AHEM_X_HEIGHT = 800;
const AHEM_CAP_HEIGHT = 800;

/**
 * R4 bridge input: the raw data of one font in font units, as a device reads it from the bundled font file (head unitsPerEm,
 * hhea ascender, descender and lineGap) and one advance per covered code point, in coveredCodePoints() order. The metrics the
 * font-relative units read follow T005's rule: xHeight is glyph x's glyf yMax, capHeight OS/2 sCapHeight, zeroAdvance the hmtx
 * advance of glyph 0.
 */
export type FontData = {
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  readonly advances: readonly number[];
  readonly xHeight: number;
  readonly capHeight: number;
  readonly zeroAdvance: number;
};

/** The Dragon covered-glyph predicate: the index of a code point in coveredCodePoints(), or -1 when Dragon does not cover it. */
export function coveredIndex(cp: number): number {
  if (cp === ZWSP) return 0x7e - 0x20;
  if (cp >= 0x20 && cp <= 0x7e && cp !== 0x27) return cp < 0x27 ? cp - 0x20 : cp - 0x21;
  return -1;
}

/** The code points a font-data measurer covers: printable ASCII except the apostrophe, then U+200B. */
export function coveredCodePoints(): number[] {
  const out: number[] = [];
  for (let cp = 0x20; cp <= 0x7e; cp++) if (cp !== 0x27) out.push(cp);
  out.push(ZWSP);
  return out;
}

/** The WPT Ahem v1.50 font data: every covered glyph advances 1em and U+200B advances 0 (css-fonts-4 §5). */
export function ahemFontData(): FontData {
  const advances = coveredCodePoints().map((cp) => (cp === ZWSP ? 0 : AHEM_UNITS_PER_EM));
  return { unitsPerEm: AHEM_UNITS_PER_EM, ascent: AHEM_ASCENT, descent: AHEM_DESCENT, lineGap: 0, advances, xHeight: AHEM_X_HEIGHT, capHeight: AHEM_CAP_HEIGHT, zeroAdvance: AHEM_UNITS_PER_EM };
}

/**
 * The float metrics of a font instance, as Chrome 145 on macOS reads them (probed at 411 sizes, notes/T026-v2a-value-model.md):
 * the x-height from glyph x's bounds, size * float(units / unitsPerEm) (SimpleFontData::PlatformInit); the cap height as Skia's
 * fCapHeight, float(size * units / unitsPerEm); the advance of 0 as the glyph advance, float(size * units / unitsPerEm) (SkFont::getWidth).
 */
export function fontMetricLengths(data: FontData, instanceSizePx: number): FontLengths {
  return {
    xHeight: glyphBoundsMetricPx(instanceSizePx, data.unitsPerEm, data.xHeight),
    capHeight: fontMetricPx(instanceSizePx, data.unitsPerEm, data.capHeight),
    zeroWidth: fontMetricPx(instanceSizePx, data.unitsPerEm, data.zeroAdvance),
  };
}

export const AHEM_FONT_DATA: FontData = ahemFontData();

/** The face id of the bundled WPT Ahem v1.50: its family name, which every milestone-1 input writes. Other faces are named by sha256. */
export const AHEM_FACE_ID = 'Ahem';

/** The sha256 of the bundled Ahem's bytes (vendor/fonts/Ahem.ttf), which a host checks before it shapes with the face. */
export const AHEM_SHA256 = 'b719ecb31c5b21fc573c03f6421c74ac63c271a5a3ff841e34f9705fb94b8448';

/** A covered code point's advance in whole em, or -1 when it is not covered or its advance is not a whole number of em. */
function emAdvance(data: FontData, cp: number): number {
  const k = coveredIndex(cp);
  if (k < 0) return -1;
  const units = data.advances[k];
  if (units === undefined) return -1;
  const em = units / data.unitsPerEm;
  return Number.isInteger(em) && em >= 0 ? em : -1;
}

/** The two macOS font rules the Ahem measurer applies (platform-rules.ts); each can be switched off by a planted fault. */
export type AhemRuleFaults = { readonly metricHalfUp: boolean; readonly untruncatedFontSize: boolean };

/** The measurer over raw font data with the translated Blink rules (R4), optionally with a platform rule planted wrong. */
export function fontDataMeasurer(data: FontData, faults: AhemRuleFaults): TextMeasurer {
  const instanceSize = (px: number): number => (faults.untruncatedFontSize ? px : platformFontSize(px));
  const round = faults.metricHalfUp ? roundFontMetricHalfUpToWholePx : roundFontMetricToWholePx;
  return {
    // Blink SimpleFontData rounds ascent and descent of the platform-size font to whole px; a zero line gap stays ZERO.
    metrics(font: TextFont): FontMetrics {
      return {
        ascent: round(fontMetricPx(instanceSize(font.size), data.unitsPerEm, data.ascent)),
        descent: round(fontMetricPx(instanceSize(font.size), data.unitsPerEm, data.descent)),
        lineGap: data.lineGap === 0 ? ZERO : round(fontMetricPx(instanceSize(font.size), data.unitsPerEm, data.lineGap)),
      };
    },
    // css-fonts-4 §5: every covered glyph advances its whole-em advance; anything else is not an Ahem glyph.
    measure(text: string, font: TextFont): MeasureResult {
      let glyphs = 0;
      for (const ch of text) {
        const cp = ch.codePointAt(0) as number;
        const advance = emAdvance(data, cp);
        if (advance < 0) return { ok: false, reason: `U+${cp.toString(16).toUpperCase()} is not an Ahem full-advance glyph` };
        glyphs += advance;
      }
      return { ok: true, measure: { width: textAdvanceAt(glyphs, instanceSize(font.size)) } };
    },
    // Blink shapes the whole item; a character's cached position is the ceiled advance sum before it (units.ts cachedRangeWidth).
    measureRange(text: string, start: number, end: number, font: TextFont): MeasureResult {
      let k = 0;
      let before = 0;
      let through = 0;
      for (const ch of text) {
        const cp = ch.codePointAt(0) as number;
        const advance = emAdvance(data, cp);
        if (advance < 0) return { ok: false, reason: `U+${cp.toString(16).toUpperCase()} is not an Ahem full-advance glyph` };
        if (k < start) before += advance;
        if (k < end) through += advance;
        k++;
      }
      return { ok: true, measure: { width: cachedRangeWidth(before, through, instanceSize(font.size)) } };
    },
    lengths(font: TextFont): FontLengths {
      return fontMetricLengths(data, instanceSize(font.size));
    },
  };
}

/** The Ahem measurer: the font-data measurer over the Ahem constants, optionally with a platform rule planted wrong. */
export function ahemMeasurerWith(faults: AhemRuleFaults): TextMeasurer {
  return fontDataMeasurer(AHEM_FONT_DATA, faults);
}

export const ahemMeasurer: TextMeasurer = ahemMeasurerWith({ metricHalfUp: false, untruncatedFontSize: false });
