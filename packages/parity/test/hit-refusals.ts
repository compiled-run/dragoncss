// The hit lane leaves out, each by name, PNT2's transform-writing cases (until SELD-R2b T146), these PNT1 cases with a stacking
// context below the root (until rt-hit.ts orders z-index and opacity layers), these INL1a inline-box and <br> cases and INL2a atomic-inline cases (rt-hit.ts
// hitRefusal) and the SVG-a1 svg cases (hit-capture.ts hitRefusal). Shared by hit-report.test.ts and lanes.test.ts so both judge
// the same exact union.
export const INLINE_OUT: readonly string[] = [
  'inline-mixed-sizes', 'inline-mixed-sizes-rtl', 'inline-empty-boxes', 'inline-empty-boxes-rtl', 'inline-br', 'inline-br-rtl', 'inline-box-boundaries',
  'inline-box-boundaries-rtl', 'inline-box-hyphen', 'inline-tags', 'inline-tags-rtl', 'inline-baselines', 'inline-baselines-rtl',
  // #266's float-clear-inert holds an inline box.
  'float-clear-inert', 'float-clear-inert-rtl',
  // TXT2-b's text-spacing-ahem holds an inline box.
  'text-spacing-ahem', 'text-spacing-ahem-rtl',
  // TXT2-f's text-overflow-fonts holds an inline box and text-overflow-lines a <br>; TXT2-e's text-transform-keywords holds an
  // inline box and text-transform-text a <br>; TXT2's text-justify-ahem holds an inline box.
  'text-overflow-lines', 'text-overflow-fonts', 'text-transform-keywords', 'text-transform-keywords-rtl', 'text-transform-text',
  'text-justify-ahem', 'text-justify-ahem-rtl',
  // TXT2-h's text-indent-ahem holds an inline box, a <br> and inline-blocks.
  'text-indent-ahem', 'text-indent-ahem-rtl',
  // INL2a: every atomic-inline case holds an inline-block or inline-flex on a line (rt-hit.ts refuses an atomic inline by name).
  ...['block', 'flex', 'breaks', 'shrink', 'north-star'].flatMap((n) => [`atomic-inline-${n}`, `atomic-inline-${n}-rtl`]), 'atomic-inline-links', 'atomic-inline-disclosure',
];
export const INLINE_REASON = /is (an inline box|a <br>|an atomic inline), which the hit table does not model yet/;
export const TRANSFORM_REASON = /^transform on .+: hit testing through transforms is SELD-R2b \(T146\)$/;
export const STACKING_OUT: readonly string[] = [
  'opacity-basic', 'opacity-basic-rtl', 'opacity-cascade', 'opacity-cascade-rtl', 'opacity-web', 'opacity-web-rtl', 'stacking-basic',
  'stacking-basic-rtl', 'stacking-context', 'stacking-context-rtl', 'stacking-escape', 'stacking-escape-rtl',
];
export const STACKING_REASON = /^stacking context on .+: hit testing through z-index and opacity layers is not modelled yet/;
// Chrome hits an svg's painted shapes (pointer-events: visiblePainted), which the hit table models with SVG-a2.
export const SVG_OUT: readonly string[] = ['svg-basic', 'svg-basic-rtl', 'svg-viewbox', 'svg-viewbox-rtl', 'svg-paint', 'svg-paint-rtl', 'svg-flex', 'svg-flex-rtl', 'svg-hidden', 'svg-hidden-rtl'];
export const SVG_REASON = /^<svg> .+: hit testing an svg's shapes comes with SVG-a2$/;
