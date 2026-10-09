// The hit lane leaves out, each by name, PNT2's transform-writing cases (until SELD-R2b T146), these INL1a inline-box and <br>
// cases (rt-hit.ts hitRefusal) and the SVG-a1 svg cases (hit-capture.ts hitRefusal). Shared by hit-report.test.ts and
// lanes.test.ts so both judge the same exact union.
export const INLINE_OUT: readonly string[] = [
  'inline-mixed-sizes', 'inline-mixed-sizes-rtl', 'inline-empty-boxes', 'inline-empty-boxes-rtl', 'inline-br', 'inline-br-rtl', 'inline-box-boundaries',
  'inline-box-boundaries-rtl', 'inline-box-hyphen', 'inline-tags', 'inline-tags-rtl', 'inline-baselines', 'inline-baselines-rtl',
];
export const INLINE_REASON = /is (an inline box|a <br>), which the hit table does not model yet/;
export const TRANSFORM_REASON = /^transform on .+: hit testing through transforms is SELD-R2b \(T146\)$/;
// Chrome hits an svg's painted shapes (pointer-events: visiblePainted), which the hit table models with SVG-a2.
export const SVG_OUT: readonly string[] = ['svg-basic', 'svg-basic-rtl', 'svg-viewbox', 'svg-viewbox-rtl', 'svg-paint', 'svg-paint-rtl', 'svg-flex', 'svg-flex-rtl', 'svg-hidden', 'svg-hidden-rtl'];
export const SVG_REASON = /^<svg> .+: hit testing an svg's shapes comes with SVG-a2$/;
