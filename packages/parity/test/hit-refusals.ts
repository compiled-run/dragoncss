// The hit lane leaves out, each by name, PNT2's cases that write a rotated transform (until SELD-R2b T146), these PNT1 cases with a
// stacking context below the root that rt-hit.ts does not order (an integer z-index, a context its hit facts do not name), these INL1a inline-box and <br> cases and the INL2a atomic-inline cases rt-hit.ts still refuses (rt-hit.ts
// hitRefusal) and the SVG-a1 svg cases (hit-capture.ts hitRefusal). Shared by hit-report.test.ts and lanes.test.ts so both judge
// the same exact union.
export const INLINE_OUT: readonly string[] = [
  // contain-intrinsic-ahem and containment-layout hold inline-blocks (their contained boxes' stacking contexts are ordered now).
  'contain-intrinsic-ahem', 'contain-intrinsic-ahem-rtl', 'containment-layout', 'containment-layout-rtl',
  // GRID-controls: the fixtures' inline-grid container sits on its line as an atomic inline.
  'grid-controls', 'grid-controls-rtl', 'grid-controls-fields',
  // GEN and TABLE (#443): an inline ::before or ::after box, and table-properties' inline boxes.
  'gen-inline-text', 'gen-inline-text-rtl', 'gen-inline-empty', 'gen-cascade', 'gen-cascade-rtl', 'gen-hr-li', 'gen-hr-li-rtl', 'gen-counters-quotes', 'gen-counters-quotes-rtl', 'table-properties', 'table-properties-rtl',
  'inline-mixed-sizes', 'inline-mixed-sizes-rtl', 'inline-empty-boxes', 'inline-empty-boxes-rtl', 'inline-br', 'inline-br-rtl', 'inline-box-boundaries',
  'inline-box-boundaries-rtl', 'inline-box-hyphen', 'inline-tags', 'inline-tags-rtl', 'inline-baselines', 'inline-baselines-rtl',
  // #266's float-clear-inert holds an inline box.
  'float-clear-inert', 'float-clear-inert-rtl',
  // TXT2-b's text-spacing-ahem and text-word-spacing-ahem hold an inline box.
  'text-spacing-ahem', 'text-spacing-ahem-rtl', 'text-word-spacing-ahem', 'text-word-spacing-ahem-rtl',
  // #266's vertical-align-inert holds an inline box (s); GRID_OUT listed it for its grid container before G-HIT.
  'vertical-align-inert', 'vertical-align-inert-rtl',
  // TXT2-f's text-overflow-fonts holds an inline box and text-overflow-lines a <br>; TXT2-e's text-transform-keywords holds an
  // inline box and text-transform-text a <br>; TXT2's text-justify-ahem and TXT2-a's text-break-ahem hold an inline box.
  'text-overflow-lines', 'text-overflow-fonts', 'text-transform-keywords', 'text-transform-keywords-rtl', 'text-transform-text',
  'text-justify-ahem', 'text-justify-ahem-rtl', 'text-break-ahem', 'text-break-ahem-rtl',
  // TXT-FX's text-stroke-ahem holds inline boxes (cur, sp).
  'text-stroke-ahem', 'text-stroke-ahem-rtl',
  // TXT2-h's text-indent-ahem holds an inline box, a <br> and inline-blocks.
  'text-indent-ahem', 'text-indent-ahem-rtl',
  // TXT-FONT's text-font-variant-ahem, text-font-variant-caps-ahem (sp), text-font-tuning-ahem, text-font-size-values-ahem, text-font-size-calc-ahem and text-font-size-vw-ahem hold inline boxes, and so does TXT-W's text-style-ahem (em, i).
  'text-font-variant-ahem', 'text-font-variant-ahem-rtl', 'text-font-variant-caps-ahem', 'text-font-variant-caps-ahem-rtl', 'text-font-tuning-ahem', 'text-font-tuning-ahem-rtl', 'text-font-size-values-ahem', 'text-font-size-values-ahem-rtl', 'text-font-size-calc-ahem', 'text-font-size-calc-ahem-rtl', 'text-font-size-vw-ahem', 'text-font-size-vw-ahem-rtl', 'text-style-ahem', 'text-style-ahem-rtl',
  // TXT-W's text-weight-bold-ahem holds inline boxes (b, strong).
  'text-weight-bold-ahem', 'text-weight-bold-ahem-rtl',
  // TXT2-d's text-word-break-ahem, TXT2-lb's text-line-break-ahem and text-line-break-webkit-ahem, and TXT2-tal's text-align-last-ahem hold inline boxes (text-align-last-ahem also a <br>).
  'text-word-break-ahem', 'text-word-break-ahem-rtl', 'text-line-break-ahem', 'text-line-break-ahem-rtl', 'text-line-break-webkit-ahem', 'text-line-break-webkit-ahem-rtl', 'text-align-last-ahem', 'text-align-last-ahem-rtl',
  // TDEC-c's text-decoration-native holds an inline box (n7s, the inline box's underline).
  'text-decoration-native', 'text-decoration-native-rtl',
  // TDEC-c's text-decoration-native-styles holds an inline box (s6s, the inline box's double underline).
  'text-decoration-native-styles', 'text-decoration-native-styles-rtl',
  // resize-values holds an inline box (sp, resize on an inline span).
  'resize-values', 'resize-values-rtl',
  // touch-action-values holds an inline box (sp, touch-action none on an inline span).
  'touch-action-values', 'touch-action-values-rtl',
  // TXT-FX's text-fill-stroke-colors holds an inline box (sp, a fill on an inline span).
  'text-fill-stroke-colors', 'text-fill-stroke-colors-rtl',
  // LEGACY-BOX's box-decoration-initial (#458) holds inline boxes (s2s, a slice across lines) and COLOR-SCHEME's color-scheme-plain (#455) inline boxes (s1e, s3a).
  'box-decoration-initial', 'box-decoration-initial-rtl', 'color-scheme-plain', 'color-scheme-plain-rtl',
  // GEN-c (#469): display-contents holds an inline box (a2), link-pseudos inline links (a1) and list-markers-disc a <br> (i1br).
  'display-contents', 'display-contents-rtl', 'link-pseudos', 'link-pseudos-rtl', 'list-markers-disc', 'list-markers-disc-rtl',
  // multicol-ahem holds <br>s (h1-h3, n1-n5).
  'multicol-ahem', 'multicol-ahem-rtl',
  // text-box-ahem holds inline boxes (h1, h2) and a <br> (i1).
  'text-box-ahem', 'text-box-ahem-rtl',
  // HIT-atomic-inline: rt-hit.ts models an atomic inline on its line, so atomic-inline-breaks, -shrink, -north-star, -links and
  // -disclosure hit; atomic-inline-block, -flex and -grid still hold a <br> inside an atomic inline (text-br, row-br).
  ...['block', 'flex', 'grid'].flatMap((n) => [`atomic-inline-${n}`, `atomic-inline-${n}-rtl`]),
  // Inline boxes: unicode-bidi-* (s1, sp), casc-all (u1), text-break-all-* (h1, b1), text-shadow-composite (l1s) and zoom-scaled (t1).
  'unicode-bidi-ltr', 'unicode-bidi-blocks', 'unicode-bidi-blocks-rtl', 'casc-all', 'casc-all-rtl', 'text-break-all-ahem', 'text-break-all-letters', 'text-break-all-letters-rtl',
  'text-shadow-composite', 'text-shadow-composite-rtl', 'zoom-scaled', 'zoom-scaled-rtl',
];
// FLT: the float cases, each holding a float (rt-hit.ts refuses a float by name).
export const FLOAT_OUT: readonly string[] = ['float-left', 'float-left-rtl', 'float-right', 'float-right-rtl', 'float-row', 'float-row-rtl', 'float-zero-width', 'float-zero-width-rtl'];
export const FLOAT_REASON = /^(?:hit test: )?\S+ is a float, which the hit table does not model yet \(FLT; no Chrome hit capture\)$/;
// GEN-c: the cases with an outside text ::marker (decimal and string markers), through whose box Chrome hits the list item
// (hit-capture.ts hitRefusal); list-markers-text holds an inline box (p1s) as well, and the marker reason comes first.
export const MARKER_OUT: readonly string[] = ['list-markers-text', 'list-markers-pseudo'];
export const MARKER_REASON = /^outside text marker on .+: Chrome hits a list item through its outside ::marker box, which rt-hit\.ts does not model yet \(GEN-c\)$/;
// TXT2-g: every line-clamp case holds a -webkit-line-clamp container (rt-hit.ts clampRefusal; line-clamp-lines' first box l1 is one,
// before its inline box l9s).
export const CLAMP_OUT: readonly string[] = ['line-clamp-lines', 'line-clamp-nested'];
export const CLAMP_REASON = /^.+ clamps its lines \(-webkit-line-clamp\), and Chrome hit tests the content past the clamp point by rules the hit table does not model yet \(TXT2-g\)$/;
export const INLINE_REASON = /is (an inline box|a <br>|an atomic inline), which the hit table does not model yet/;
// ALIAS-2's alias-paint writes a rotating -webkit-transform and backface-values rotates its boxes, so the hit lane refuses them with the
// transform reason though their names are not transform-.
export const TRANSFORM_NAMED: readonly string[] = ['alias-paint', 'backface-values', 'backface-values-rtl'];
export const TRANSFORM_REASON = /^transform on .+: hit testing through a rotated transform is SELD-R2b \(T146\)$/;
// The opacity, filter, isolation, backdrop-filter, mix-blend-mode, mask and containment cases whose every stacking context is in the
// z-index 0 layer are in the hit lane (rt-hit.ts orders them as their own layers); these hold one in another layer (an integer
// z-index), a normal-flow layer, or one their hit facts do not name (opacity-group-clipped's clip has z-index: 0).
export const STACKING_OUT: readonly string[] = [
  // A z-index layer (the modal's backdrop) keeps the notes modal fixtures out.
  'opacity-group-modal', 'opacity-group-modal-rtl', 'opacity-group-modal-sticky', 'opacity-group-modal-sticky-rtl',
  'opacity-group-clipped', 'opacity-group-clipped-rtl', 'stacking-basic',
  'stacking-basic-rtl', 'stacking-context', 'stacking-context-rtl', 'stacking-escape', 'stacking-escape-rtl', 'stacking-grid-items',
  'stacking-grid-items-rtl', 'stacking-isolation', 'stacking-isolation-rtl', 'stacking-backface', 'stacking-backface-rtl',
  // stacking-transform's transforms translate only, and its t-r2 has an integer z-index; isolation-stacking holds negative and positive z-index layers.
  'stacking-transform', 'stacking-transform-rtl', 'isolation-stacking', 'isolation-stacking-rtl',
  // Positioned boxes with a z-index and fixed boxes make stacking contexts below the root.
  ...['fixed-probe', 'fixed-viewport', 'fixed-in-grid', 'anchor-containing-blocks'].flatMap((n) => [n, `${n}-rtl`]),
];
export const STACKING_REASON = /^stacking context on .+: hit testing through z-index layers and stacking contexts in the normal flow is not modelled yet/;
// Chrome hits an svg's painted shapes (pointer-events: visiblePainted), which the hit table models with SVG-a2. svg-hidden is in
// VISIBILITY_OUT instead: its <svg> s3 is visibility hidden, and hitRefusal names visibility before an svg.
export const SVG_OUT: readonly string[] = ['svg-basic', 'svg-basic-rtl', 'svg-viewbox', 'svg-viewbox-rtl', 'svg-paint', 'svg-paint-rtl', 'svg-flex', 'svg-flex-rtl', 'svg-colors', 'svg-colors-rtl', 'svg-opacity', 'svg-opacity-rtl', 'svg-stroke', 'svg-stroke-rtl', 'svg-dash', 'svg-dash-rtl', 'svg-geometry', 'svg-geometry-rtl', 'svg-paint-order', 'svg-paint-order-rtl', 'svg-rrect', 'svg-rrect-rtl', 'svg-vector-effect', 'svg-vector-effect-rtl', 'svg-inert', 'svg-inert-rtl', 'inline-replaced-svg', 'inline-replaced-svg-rtl'];
export const SVG_REASON = /^<svg> .+: hit testing an svg's shapes comes with SVG-a2$/;

// TXT1a-2 phase R: the device lanes run the shaped cases (targets.ts deviceCaseIds), but the hit lane keeps them out until real-face hit
// points are proven (hit-capture.ts hitRefusal names this before any other reason). The set is text-latin-run.ts shapedCaseIds.
export const SHAPED_REASON = /^shaped text \(text-latin-run\.ts isShapedInput\): the hit lane runs the plain cases until TXT1a-2 proves real-face hit points$/;
