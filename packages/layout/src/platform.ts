// Text measurers keyed by capture platform (docs/decisions.md, Linux lane scope). Chrome's font metric rounding differs per
// platform, so a platform with no registered rules is refused with a typed code; it is never measured with another platform's rules.
import type { EngineFaults } from './block.ts';
import { NO_ENGINE_FAULTS } from './block.ts';
import type { PlatformRule } from './platform-rules.ts';
import { PLATFORM_RULES } from './platform-rules.ts';
import type { GlyphShaper, ShapedFace, ShapingFaults } from './shaping.ts';
import { latinScopedMeasurer, NO_HAN_KERNING, shapedMeasurer } from './shaping.ts';
import type { FontData, TextMeasurer } from './text.ts';
import { ahemMeasurer } from './text.ts';

/** The platform the committed Chrome references were captured on. */
export const REFERENCE_PLATFORM = 'darwin-arm64';

/** The BCP 47 tag HarfBuzz shapes with when no lang attribute applies: the pinned Chrome's default locale. */
export const REFERENCE_LANGUAGE = 'en-US';

export type MeasurerChoice =
  | { readonly kind: 'ok'; readonly platform: string; readonly key: string; readonly measurer: TextMeasurer; readonly rules: readonly PlatformRule[] }
  | { readonly kind: 'refused'; readonly code: 'no-platform-rules'; readonly platform: string; readonly detail: string };

/** A registered measurer and its key. */
type MeasurerEntry = { readonly key: string; readonly measurer: TextMeasurer };

const MEASURERS: ReadonlyMap<string, MeasurerEntry> = new Map([
  ['darwin-arm64', { key: 'ahem/darwin-arm64', measurer: ahemMeasurer }],
]);

/** The Ahem measurer with the platform rules of one capture platform, or a typed refusal. */
export function measurerFor(platform: string): MeasurerChoice {
  const m = MEASURERS.get(platform);
  const rules = PLATFORM_RULES.get(platform);
  if (m === undefined || rules === undefined) {
    return { kind: 'refused', code: 'no-platform-rules', platform, detail: `no platform rules are registered for ${platform}; its font metric rounding is unmeasured` };
  }
  return { kind: 'ok', platform, key: m.key, measurer: m.measurer, rules };
}

/** The shaping plants of a set of engine faults (shaping.ts ShapingFaults). */
export function shapingFaultsOf(faults: EngineFaults): ShapingFaults {
  return {
    advanceNot16_16: faults.advanceNot16_16,
    doubleAccumulation: faults.doubleAccumulation,
    noReshapeAtBreak: faults.noReshapeAtBreak,
    kerningDropped: faults.kerningDropped,
    wholePixelPositions: faults.wholePixelPositions,
    softHyphenWidthMissing: faults.softHyphenWidthMissing,
    metricRoundingSwapped: faults.metricRoundingSwapped,
  };
}

/**
 * R2 (notes/T056-txt1a-spec.md): the measurer over the host's bundled faces, keyed by face id, and its HarfBuzz, with the platform
 * rules of one capture platform, or a typed refusal. Ahem goes through it as every other face does. language is the BCP 47 tag
 * HarfBuzz shapes with: the content language, which is the browser's default locale when no lang attribute applies. Text outside
 * Latin, Common and Inherited is refused (R4, latinScopedMeasurer).
 */
export function shapedMeasurerFor(platform: string, faces: ReadonlyMap<string, ShapedFace>, shaper: GlyphShaper, language: string, faults: EngineFaults): MeasurerChoice {
  const rules = PLATFORM_RULES.get(platform);
  if (!MEASURERS.has(platform) || rules === undefined) {
    return { kind: 'refused', code: 'no-platform-rules', platform, detail: `no platform rules are registered for ${platform}; its font metric rounding is unmeasured` };
  }
  return { kind: 'ok', platform, key: `shaped/${platform}`, measurer: latinScopedMeasurer(shapedMeasurer(faces, shaper, shapingFaultsOf(faults), language), faults.latinCheckSkipped), rules };
}

/**
 * R2 on a device (TXT1a-2 phase R): shapedMeasurerFor at REFERENCE_PLATFORM and REFERENCE_LANGUAGE with no plants, over the faces
 * an app bundles (FontData read from their bytes, keyed by face id) and the app's HarfBuzz. HanKerning reads only Chinese and
 * Japanese text, so no face carries HanKerning data in this language (text-shaper-host.ts hanKerningOf).
 */
export function deviceShapedMeasurer(faces: ReadonlyMap<string, FontData>, shaper: GlyphShaper): TextMeasurer {
  const shaped = new Map<string, ShapedFace>();
  for (const [id, data] of faces) shaped.set(id, { id, data, hanKerning: NO_HAN_KERNING });
  const m = shapedMeasurerFor(REFERENCE_PLATFORM, shaped, shaper, REFERENCE_LANGUAGE, NO_ENGINE_FAULTS);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  return m.measurer;
}
