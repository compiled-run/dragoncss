// The hit lane leaves out, each by name, PNT2's transform-writing cases (until SELD-R2b T146), these PNT1 cases with a stacking
// context below the root (until rt-hit.ts orders z-index and opacity layers), these INL1a inline-box and <br> cases and INL2a atomic-inline cases (rt-hit.ts
// hitRefusal) and the SVG-a1 svg cases (hit-capture.ts hitRefusal). Shared by hit-report.test.ts and lanes.test.ts so both judge
// the same exact union.
export const INLINE_OUT: readonly string[] = [
  'inline-mixed-sizes', 'inline-mixed-sizes-rtl', 'inline-empty-boxes', 'inline-empty-boxes-rtl', 'inline-br', 'inline-br-rtl', 'inline-box-boundaries',
  'inline-box-boundaries-rtl', 'inline-box-hyphen', 'inline-tags', 'inline-tags-rtl', 'inline-baselines', 'inline-baselines-rtl',
  // #266's float-clear-inert holds an inline box.
  'float-clear-inert', 'float-clear-inert-rtl',
  // TXT2-b's text-spacing-ahem and text-word-spacing-ahem hold an inline box.
  'text-spacing-ahem', 'text-spacing-ahem-rtl', 'text-word-spacing-ahem', 'text-word-spacing-ahem-rtl',
  // #266's vertical-align-inert holds an inline-block (an atomic inline); GRID_OUT listed it for its grid container before G-HIT.
  'vertical-align-inert', 'vertical-align-inert-rtl',
  // TXT2-f's text-overflow-fonts holds an inline box and text-overflow-lines a <br>; TXT2-e's text-transform-keywords holds an
  // inline box and text-transform-text a <br>; TXT2's text-justify-ahem and TXT2-a's text-break-ahem hold an inline box.
  'text-overflow-lines', 'text-overflow-fonts', 'text-transform-keywords', 'text-transform-keywords-rtl', 'text-transform-text',
  'text-justify-ahem', 'text-justify-ahem-rtl', 'text-break-ahem', 'text-break-ahem-rtl',
  // TXT-FX's text-stroke-ahem holds inline boxes (cur, sp).
  'text-stroke-ahem', 'text-stroke-ahem-rtl',
  // TXT2-h's text-indent-ahem holds an inline box, a <br> and inline-blocks.
  'text-indent-ahem', 'text-indent-ahem-rtl',
  // TXT-FONT's text-font-variant-ahem, text-font-variant-caps-ahem (sp), text-font-tuning-ahem and text-font-size-values-ahem hold inline boxes, and so does TXT-W's text-style-ahem (em, i).
  'text-font-variant-ahem', 'text-font-variant-ahem-rtl', 'text-font-variant-caps-ahem', 'text-font-variant-caps-ahem-rtl', 'text-font-tuning-ahem', 'text-font-tuning-ahem-rtl', 'text-font-size-values-ahem', 'text-font-size-values-ahem-rtl', 'text-style-ahem', 'text-style-ahem-rtl',
  // TXT-W's text-weight-bold-ahem holds inline boxes (b, strong).
  'text-weight-bold-ahem', 'text-weight-bold-ahem-rtl',
  // TDEC-c's text-decoration-native holds an inline box (n7s, the inline box's underline).
  'text-decoration-native', 'text-decoration-native-rtl',
  // TDEC-c's text-decoration-native-styles holds an inline box (s6s, the inline box's double underline).
  'text-decoration-native-styles', 'text-decoration-native-styles-rtl',
  // resize-values holds an inline box (sp, resize on an inline span).
  'resize-values', 'resize-values-rtl',
  // touch-action-values holds an inline box (sp, touch-action none on an inline span).
  'touch-action-values', 'touch-action-values-rtl',
  // INL2a: every atomic-inline case holds an inline-block, inline-flex or inline-grid on a line (rt-hit.ts refuses an atomic inline by name).
  ...['block', 'flex', 'grid', 'breaks', 'shrink', 'north-star'].flatMap((n) => [`atomic-inline-${n}`, `atomic-inline-${n}-rtl`]), 'atomic-inline-links', 'atomic-inline-disclosure',
];
// TXT2-g: every line-clamp case holds a -webkit-line-clamp container (rt-hit.ts clampRefusal; line-clamp-lines' first box l1 is one,
// before its inline box l9s).
export const CLAMP_OUT: readonly string[] = ['line-clamp-lines', 'line-clamp-nested'];
export const CLAMP_REASON = /^.+ clamps its lines \(-webkit-line-clamp\), and Chrome hit tests the content past the clamp point by rules the hit table does not model yet \(TXT2-g\)$/;
export const INLINE_REASON = /is (an inline box|a <br>|an atomic inline), which the hit table does not model yet/;
// ALIAS-2's alias-paint writes -webkit-transform, so the hit lane refuses it with the transform reason though its name is not transform-.
export const TRANSFORM_NAMED: readonly string[] = ['alias-paint'];
export const TRANSFORM_REASON = /^transform on .+: hit testing through transforms is SELD-R2b \(T146\)$/;
export const STACKING_OUT: readonly string[] = [
  'opacity-basic', 'opacity-basic-rtl', 'opacity-cascade', 'opacity-cascade-rtl', 'opacity-web', 'opacity-web-rtl', 'stacking-basic',
  'stacking-basic-rtl', 'stacking-context', 'stacking-context-rtl', 'stacking-escape', 'stacking-escape-rtl', 'stacking-grid-items',
  'stacking-grid-items-rtl',
];
export const STACKING_REASON = /^stacking context on .+: hit testing through z-index and opacity layers is not modelled yet/;
// Chrome hits an svg's painted shapes (pointer-events: visiblePainted), which the hit table models with SVG-a2. svg-hidden is in
// VISIBILITY_OUT instead: its <svg> s3 is visibility hidden, and hitRefusal names visibility before an svg.
export const SVG_OUT: readonly string[] = ['svg-basic', 'svg-basic-rtl', 'svg-viewbox', 'svg-viewbox-rtl', 'svg-paint', 'svg-paint-rtl', 'svg-flex', 'svg-flex-rtl', 'svg-colors', 'svg-colors-rtl', 'svg-opacity', 'svg-opacity-rtl', 'svg-stroke', 'svg-stroke-rtl', 'svg-dash', 'svg-dash-rtl', 'svg-geometry', 'svg-geometry-rtl', 'svg-paint-order', 'svg-paint-order-rtl', 'svg-rrect', 'svg-rrect-rtl', 'svg-vector-effect', 'svg-vector-effect-rtl'];
export const SVG_REASON = /^<svg> .+: hit testing an svg's shapes comes with SVG-a2$/;
