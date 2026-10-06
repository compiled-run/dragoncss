// The hit lane leaves out, by name, the svg fixture cases (hit-capture.ts hitRefusal): Chrome hits an svg's painted shapes
// (pointer-events: visiblePainted), which the hit table does not model yet. Shared by hit-report.test.ts and lanes.test.ts.
export const SVG_OUT: readonly string[] = ['svg-basic', 'svg-basic-rtl', 'svg-viewbox', 'svg-viewbox-rtl', 'svg-paint', 'svg-paint-rtl', 'svg-flex', 'svg-flex-rtl'];
export const SVG_REASON = /^<svg> .+: hit testing an svg's shapes comes with SVG-a2$/;
