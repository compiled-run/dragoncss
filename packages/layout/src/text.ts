// Text measurement is injected. The Ahem measurer is pure: it models the WPT Ahem v1.50 metrics without reading the font.
import type { TextFont } from './input.ts';
import type { LU } from './units.ts';
import { fontMetricPx, max, roundFontMetricToWholePx, textAdvance, ZERO } from './units.ts';

export type FontMetrics = { readonly ascent: LU; readonly descent: LU; readonly lineGap: LU };

export type TextMeasure = {
  /** Advance of the whole run on one line. */
  readonly width: LU;
  /** Widest piece between break opportunities (the min-content inline size). */
  readonly minContentWidth: LU;
  readonly hasBreakOpportunity: boolean;
};

export type MeasureResult = { readonly ok: true; readonly measure: TextMeasure } | { readonly ok: false; readonly reason: string };

export interface TextMeasurer {
  metrics(font: TextFont): FontMetrics;
  measure(text: string, font: TextFont): MeasureResult;
}

const SPACE = 0x20;
const ZWSP = 0x200b;
const AHEM_UNITS_PER_EM = 1000;
const AHEM_ASCENT = 800;
const AHEM_DESCENT = 200;

function ahemAdvances(cp: number): number {
  if (cp === ZWSP) return 0;
  if (cp >= 0x20 && cp <= 0x7e && cp !== 0x27) return 1;
  return -1;
}

export const ahemMeasurer: TextMeasurer = {
  // Blink SimpleFontData rounds ascent and descent to whole px (SkScalarRoundToScalar); Ahem has no line gap.
  metrics(font: TextFont): FontMetrics {
    return {
      ascent: roundFontMetricToWholePx(fontMetricPx(font.size, AHEM_UNITS_PER_EM, AHEM_ASCENT)),
      descent: roundFontMetricToWholePx(fontMetricPx(font.size, AHEM_UNITS_PER_EM, AHEM_DESCENT)),
      lineGap: ZERO,
    };
  },
  // UAX #14 subset for Ahem test text: breaks after spaces and at U+200B; every covered glyph advances 1em.
  measure(text: string, font: TextFont): MeasureResult {
    let glyphs = 0;
    let segmentGlyphs = 0;
    let widestSegment = ZERO;
    let breaks = false;
    const cps = Array.from(text, (ch) => ch.codePointAt(0) as number);
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i] as number;
      const advance = ahemAdvances(cp);
      if (advance < 0) return { ok: false, reason: `U+${cp.toString(16).toUpperCase()} is not an Ahem full-advance glyph` };
      const isBreak = cp === SPACE || cp === ZWSP;
      if (isBreak) {
        if (i > 0 && i < cps.length - 1) breaks = true;
        widestSegment = max(widestSegment, textAdvance(segmentGlyphs, font.size));
        segmentGlyphs = 0;
      } else {
        segmentGlyphs += advance;
      }
      glyphs += advance;
    }
    widestSegment = max(widestSegment, textAdvance(segmentGlyphs, font.size));
    return { ok: true, measure: { width: textAdvance(glyphs, font.size), minContentWidth: widestSegment, hasBreakOpportunity: breaks } };
  },
};
