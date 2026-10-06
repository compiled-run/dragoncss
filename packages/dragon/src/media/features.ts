// The media features Dragon evaluates, and the ones Chrome knows that depend on the device or the user (refused until MQ-R2 or
// MQ-R3, notes/T067 §1).

/** The viewport features: evaluated on the root's media size. */
export const VIEWPORT_FEATURES: ReadonlySet<string> = new Set(['width', 'height', 'aspect-ratio', 'orientation']);
/**
 * MQ-R2 (T067 R9): the device features Dragon reads on each platform. resolution and -webkit-device-pixel-ratio are the device
 * scale; the rest are discrete readings of the pointing devices and the user's motion setting. prefers-color-scheme waits for PNT1.
 */
export const DEVICE_FEATURES: ReadonlySet<string> = new Set(['resolution', '-webkit-device-pixel-ratio', 'pointer', 'any-pointer', 'hover', 'any-hover', 'prefers-reduced-motion']);
export const RANGE_FEATURES: ReadonlySet<string> = new Set(['width', 'height', 'aspect-ratio', 'resolution', '-webkit-device-pixel-ratio']);
export const EVALUATED_FEATURES: ReadonlySet<string> = new Set([...VIEWPORT_FEATURES, ...DEVICE_FEATURES]);
/** The keywords of each discrete device feature, in Chrome's order. */
export const DEVICE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  pointer: ['none', 'coarse', 'fine'],
  'any-pointer': ['none', 'coarse', 'fine'],
  hover: ['none', 'hover'],
  'any-hover': ['none', 'hover'],
  'prefers-reduced-motion': ['no-preference', 'reduce'],
};

/**
 * Chrome 145 features whose value depends on the device, the user or the display mode. They parse and serialise, and every
 * query that uses one is refused. The min-/max- forms are accepted for the range ones.
 */
export const ENVIRONMENT_FEATURES: ReadonlySet<string> = new Set([
  'prefers-color-scheme', 'prefers-contrast', 'prefers-reduced-transparency', 'prefers-reduced-data',
  'color', 'color-index', 'monochrome', 'color-gamut', 'dynamic-range', 'video-dynamic-range', 'forced-colors', 'inverted-colors',
  'scripting', 'update', 'overflow-block', 'overflow-inline', 'grid', 'display-mode', 'scan',
  'device-width', 'device-height', 'device-aspect-ratio', 'device-posture',
  'horizontal-viewport-segments', 'vertical-viewport-segments', 'navigation-controls', '-webkit-transform-3d',
]);

/** Splits an authored feature name (lowercased) into its min-/max- prefix and base name. */
export function splitFeatureName(name: string): { readonly prefix: 'min' | 'max' | null; readonly base: string } {
  for (const p of ['min', 'max'] as const) {
    // A vendor feature takes its prefix after the vendor (-webkit-min-...); min--webkit-... is no feature (Chrome 145).
    if (name.startsWith(`${p}-`) && !name.startsWith(`${p}--`)) return { prefix: p, base: name.slice(4) };
    if (name.startsWith(`-webkit-${p}-`)) return { prefix: p, base: `-webkit-${name.slice(12)}` };
  }
  return { prefix: null, base: name };
}

/** Environment features are refused, including any prefers-* Chrome does not know (prefers-reduced-motion is read, MQ-R2). */
export function isEnvironmentFeature(base: string): boolean {
  return ENVIRONMENT_FEATURES.has(base) || (base.startsWith('prefers-') && !DEVICE_FEATURES.has(base));
}
