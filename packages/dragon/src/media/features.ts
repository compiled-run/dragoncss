// The media features Dragon evaluates, and the ones Chrome knows that depend on the device or the user (refused until MQ-R).

/** Evaluated from the viewport. */
export type EvaluatedFeature = 'width' | 'height' | 'aspect-ratio' | 'orientation';
export const RANGE_FEATURES: ReadonlySet<string> = new Set(['width', 'height', 'aspect-ratio']);
export const EVALUATED_FEATURES: ReadonlySet<string> = new Set(['width', 'height', 'aspect-ratio', 'orientation']);

/**
 * Chrome 145 features whose value depends on the device, the user or the display mode. They parse and serialise, and every
 * query that uses one is refused. The min-/max- forms are accepted for the range ones.
 */
export const ENVIRONMENT_FEATURES: ReadonlySet<string> = new Set([
  'hover', 'any-hover', 'pointer', 'any-pointer', 'resolution', '-webkit-device-pixel-ratio',
  'prefers-color-scheme', 'prefers-contrast', 'prefers-reduced-motion', 'prefers-reduced-transparency', 'prefers-reduced-data',
  'color', 'color-index', 'monochrome', 'color-gamut', 'dynamic-range', 'video-dynamic-range', 'forced-colors', 'inverted-colors',
  'scripting', 'update', 'overflow-block', 'overflow-inline', 'grid', 'display-mode', 'scan',
  'device-width', 'device-height', 'device-aspect-ratio', 'device-posture',
  'horizontal-viewport-segments', 'vertical-viewport-segments', 'navigation-controls', '-webkit-transform-3d',
]);

/** Splits an authored feature name (lowercased) into its min-/max- prefix and base name. */
export function splitFeatureName(name: string): { readonly prefix: 'min' | 'max' | null; readonly base: string } {
  for (const p of ['min', 'max'] as const) {
    if (name.startsWith(`${p}-`)) return { prefix: p, base: name.slice(4) };
    if (name.startsWith(`-webkit-${p}-`)) return { prefix: p, base: `-webkit-${name.slice(12)}` };
  }
  return { prefix: null, base: name };
}

/** Environment features are refused, including any prefers-* Chrome does not know. */
export function isEnvironmentFeature(base: string): boolean {
  return ENVIRONMENT_FEATURES.has(base) || base.startsWith('prefers-');
}
