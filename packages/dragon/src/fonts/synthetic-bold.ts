// TXT-W: Skia's fake bold, which Chrome draws a synthetic bold with: the stroke width the native views and the host pixel model use.

/**
 * Skia's fake bold, which Chrome's synthetic bold is on macOS (SkTypeface_mac_ct.cpp:887-888 onFilterRec): the glyph outline is stroked
 * and filled with the default paint's miter join (limit 4) at a width of size * scale (SkScalerContext.cpp:1017-1039
 * useStrokeForFakeBold), where scale interpolates between these (size, scale) keys (SkTextFormatParams.h:15-29).
 */
export const SYNTHETIC_BOLD_KEYS: readonly [number, number] = [9, 36];
export const SYNTHETIC_BOLD_VALUES: readonly [number, number] = [Math.fround(1 / 24), Math.fround(1 / 32)];

/** The fake-bold stroke width at a font instance size, both in device px: SkFloatInterpFunc (SkScalar.cpp:11-37), then size * scale, in float. */
export function syntheticBoldStroke(size: number, keys: readonly [number, number] = SYNTHETIC_BOLD_KEYS, values: readonly [number, number] = SYNTHETIC_BOLD_VALUES): number {
  const s = Math.fround(size);
  let scale: number;
  if (s <= keys[0]) scale = values[0];
  else if (s > keys[1]) scale = values[1];
  else {
    const t = Math.fround(Math.fround(s - keys[0]) / Math.fround(keys[1] - keys[0]));
    scale = Math.fround(values[0] + Math.fround(Math.fround(values[1] - values[0]) * t));
  }
  return Math.fround(s * scale);
}
