// TXT-FONTFEAT: font-variant-numeric on the shaped path. The shaper turns each keyword into its OpenType feature over the whole item,
// in Blink's order (shaping.ts numericFeatures), after chws. The fake shaper below records the features it is given and
// draws a digit 6px wide, or 10px under tnum, so numericFeaturesDropped changes a width here; the Chrome checks are
// packages/parity/test/text-font-variant-numeric.test.ts.
import { describe, expect, it } from 'vitest';
import { NO_SHAPING_FAULTS, NORMAL_NUMERIC } from '../src/index.ts';
import type { ShapingFaults, VariantNumeric } from '../src/index.ts';
import type { GlyphShaper } from '../src/shaping.ts';
import { FEATURE_STRIDE, FEATURE_TO_END, NO_HAN_KERNING, shapedMeasurer } from '../src/shaping.ts';
import { AHEM_FONT_DATA } from '../src/text.ts';

const name = (n: number): string => String.fromCharCode(Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256);

function measure(v: VariantNumeric, faults: ShapingFaults = NO_SHAPING_FAULTS): { readonly width: number; readonly features: readonly string[] } {
  let seen: string[] = [];
  const shaper: GlyphShaper = {
    shape(_face, size, t, start, end, _script, _rtl, _language, features) {
      seen = [];
      for (let i = 0; i < features.length; i += FEATURE_STRIDE) {
        expect([features[i + 2], features[i + 3]]).toEqual([0, FEATURE_TO_END]);
        seen.push(`${name(features[i] as number)}=${String(features[i + 1])}`);
      }
      const tabular = seen.includes('tnum=1');
      const out: number[] = [];
      for (let i = start; i < end; i++) out.push(1, i, ((t[i] ?? '') >= '0' && (t[i] ?? '') <= '9' ? (tabular ? 10 : 6) : 10) * (size / 10) * 65536, 0, 0, 0, 0);
      return out;
    },
    fallback: (): string => '',
  };
  const m = shapedMeasurer(new Map([['Fake', { id: 'Fake', data: AHEM_FONT_DATA, hanKerning: NO_HAN_KERNING }]]), shaper, faults, 'en');
  const r = m.measure('1100', { family: 'Fake', size: 10, letterSpacing: 0, wordSpacing: 0, smallCaps: false, variantNumeric: v });
  if (!r.ok) throw new Error(r.reason);
  return { width: r.measure.width / 64, features: seen };
}

describe('font-variant-numeric on the shaped path', () => {
  it('adds no feature for normal', () => {
    expect(measure(NORMAL_NUMERIC)).toEqual({ width: 24, features: ['chws=1'] });
  });
  it('turns each keyword into its feature, in Blink order after chws', () => {
    expect(measure({ ...NORMAL_NUMERIC, spacing: 'tabular-nums' })).toEqual({ width: 40, features: ['chws=1', 'tnum=1'] });
    expect(measure({ figure: 'oldstyle-nums', spacing: 'proportional-nums', fraction: 'diagonal-fractions', ordinal: true, slashedZero: true }).features).toEqual(['chws=1', 'onum=1', 'pnum=1', 'frac=1', 'ordn=1', 'zero=1']);
    expect(measure({ figure: 'lining-nums', spacing: 'normal', fraction: 'stacked-fractions', ordinal: false, slashedZero: false }).features).toEqual(['chws=1', 'lnum=1', 'afrc=1']);
  });
  it('shapes a text once per variant: the cache keys on it', () => {
    const shaper: GlyphShaper = { shape: (_f, size, _t, start, end, _s, _r, _l, features) => Array.from({ length: end - start }, (_, k) => [1, start + k, (features.length > FEATURE_STRIDE ? 10 : 6) * (size / 10) * 65536, 0, 0, 0, 0]).flat(), fallback: (): string => '' };
    const m = shapedMeasurer(new Map([['Fake', { id: 'Fake', data: AHEM_FONT_DATA, hanKerning: NO_HAN_KERNING }]]), shaper, NO_SHAPING_FAULTS, 'en');
    const at = (v: VariantNumeric): number => {
      const r = m.measure('11', { family: 'Fake', size: 10, letterSpacing: 0, wordSpacing: 0, smallCaps: false, variantNumeric: v });
      return r.ok ? r.measure.width / 64 : -1;
    };
    expect([at(NORMAL_NUMERIC), at({ ...NORMAL_NUMERIC, spacing: 'tabular-nums' }), at(NORMAL_NUMERIC)]).toEqual([12, 20, 12]);
  });
  it('numericFeaturesDropped shapes without them, which changes the tabular width', () => {
    expect(measure({ ...NORMAL_NUMERIC, spacing: 'tabular-nums' }, { ...NO_SHAPING_FAULTS, numericFeaturesDropped: true })).toEqual({ width: 24, features: ['chws=1'] });
  });
});
