// -webkit-text-fill-color, -webkit-text-stroke-color and -webkit-text-stroke-width (compat §5), and the -webkit-text-stroke
// shorthand of the last two: all inherited, initial currentcolor, currentcolor and 0. Dragon paints glyphs in color (TXT-FX), so it
// accepts a fill of currentcolor (computed-checks.ts checkTextFillStroke refuses the rest), and strokes them where
// analysis/text-stroke.ts checkTextStrokes finds the native view draws what Chrome draws.
import type { PropertyAspect } from '../properties.ts';

export const TEXT_FILL_STROKE_LONGHANDS = ['-webkit-text-fill-color', '-webkit-text-stroke-color', '-webkit-text-stroke-width'] as const;
export const TEXT_FILL_STROKE_SHORTHANDS = ['-webkit-text-stroke'] as const;
export const TEXT_FILL_STROKE_INHERITED: readonly (typeof TEXT_FILL_STROKE_LONGHANDS)[number][] = ['-webkit-text-fill-color', '-webkit-text-stroke-color', '-webkit-text-stroke-width'];
export const TEXT_FILL_STROKE_CONTAINER: readonly (typeof TEXT_FILL_STROKE_LONGHANDS)[number][] = [];
export const TEXT_FILL_STROKE_TEXT_ROLE: readonly (typeof TEXT_FILL_STROKE_LONGHANDS)[number][] = [];

export const TEXT_FILL_STROKE_ASPECTS: { readonly [P in (typeof TEXT_FILL_STROKE_LONGHANDS)[number]]: PropertyAspect } = {
  '-webkit-text-fill-color': { layout: false, paint: true },
  '-webkit-text-stroke-color': { layout: false, paint: true },
  '-webkit-text-stroke-width': { layout: false, paint: true },
};
