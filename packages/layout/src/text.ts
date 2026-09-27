// Text measurement is injected. The Ahem measurer is pure: it models the WPT Ahem v1.50 metrics without reading the font.
import type { TextFont } from './input.ts';
import type { LU } from './units.ts';
import { fontMetricPx, platformFontSize, roundFontMetricToWholePx, textAdvance, ZERO } from './units.ts';

export type FontMetrics = { readonly ascent: LU; readonly descent: LU; readonly lineGap: LU };

/** The advance of one run of text on one line. */
export type TextMeasure = { readonly width: LU };

export type MeasureResult = { readonly ok: true; readonly measure: TextMeasure } | { readonly ok: false; readonly reason: string };

export interface TextMeasurer {
  metrics(font: TextFont): FontMetrics;
  measure(text: string, font: TextFont): MeasureResult;
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

export const ahemMeasurer: TextMeasurer = {
  // Blink SimpleFontData rounds ascent and descent of the platform-size font to whole px; Ahem has no line gap.
  metrics(font: TextFont): FontMetrics {
    return {
      ascent: roundFontMetricToWholePx(fontMetricPx(platformFontSize(font.size), AHEM_UNITS_PER_EM, AHEM_ASCENT)),
      descent: roundFontMetricToWholePx(fontMetricPx(platformFontSize(font.size), AHEM_UNITS_PER_EM, AHEM_DESCENT)),
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
    return { ok: true, measure: { width: textAdvance(glyphs, font.size) } };
  },
};
