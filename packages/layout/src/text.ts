// Text measurement is injected. The Ahem measurer is pure: it models the WPT Ahem v1.50 metrics without reading the font.
import type { TextFont } from './input.ts';
import type { LU } from './units.ts';
import { cachedRangeWidth, fontMetricPx, platformFontSize, roundFontMetricHalfUpToWholePx, roundFontMetricToWholePx, textAdvanceAt, ZERO } from './units.ts';

export type FontMetrics = { readonly ascent: LU; readonly descent: LU; readonly lineGap: LU };

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
}

const ZWSP = 0x200b;
const AHEM_UNITS_PER_EM = 1000;
const AHEM_ASCENT = 800;
const AHEM_DESCENT = 200;

function ahemAdvances(cp: number): number {
  if (cp === ZWSP) return 0;
  if (cp >= 0x20 && cp <= 0x7e && cp !== 0x27) return 1;
  return -1;
}

/** The two macOS font rules the Ahem measurer applies (platform-rules.ts); each can be switched off by a planted fault. */
export type AhemRuleFaults = { readonly metricHalfUp: boolean; readonly untruncatedFontSize: boolean };

/** The Ahem measurer, optionally with a platform rule planted wrong. */
export function ahemMeasurerWith(faults: AhemRuleFaults): TextMeasurer {
  const instanceSize = (px: number): number => (faults.untruncatedFontSize ? px : platformFontSize(px));
  const round = faults.metricHalfUp ? roundFontMetricHalfUpToWholePx : roundFontMetricToWholePx;
  return {
    // Blink SimpleFontData rounds ascent and descent of the platform-size font to whole px; Ahem has no line gap.
    metrics(font: TextFont): FontMetrics {
      return {
        ascent: round(fontMetricPx(instanceSize(font.size), AHEM_UNITS_PER_EM, AHEM_ASCENT)),
        descent: round(fontMetricPx(instanceSize(font.size), AHEM_UNITS_PER_EM, AHEM_DESCENT)),
        lineGap: ZERO,
      };
    },
    // css-fonts-4 §5: every covered Ahem glyph advances 1em and U+200B advances 0; anything else is not an Ahem glyph.
    measure(text: string, font: TextFont): MeasureResult {
      let glyphs = 0;
      for (const ch of text) {
        const cp = ch.codePointAt(0) as number;
        const advance = ahemAdvances(cp);
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
        const advance = ahemAdvances(cp);
        if (advance < 0) return { ok: false, reason: `U+${cp.toString(16).toUpperCase()} is not an Ahem full-advance glyph` };
        if (k < start) before += advance;
        if (k < end) through += advance;
        k++;
      }
      return { ok: true, measure: { width: cachedRangeWidth(before, through, instanceSize(font.size)) } };
    },
  };
}

export const ahemMeasurer: TextMeasurer = ahemMeasurerWith({ metricHalfUp: false, untruncatedFontSize: false });
