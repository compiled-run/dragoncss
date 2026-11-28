// The hit lane leaves out, by name, these clip fixture cases (hit-capture.ts hitRefusal). A box an empty clip rect or clip-path hides
// is hit by nothing in Chrome, nor is its subtree, and the hit facts say so (MASK-CLIP-path-hidden), so clip-rect-basic and
// attr-style-visually-hidden are in the lane; the two clip-rect fixtures below stay out for what they hold besides the clip.
// Shared by hit-report.test.ts and lanes.test.ts.
export const CLIP_RECT_OUT: readonly string[] = ['clip-rect-nested', 'clip-rect-nested-rtl', 'clip-rect-sr-only', 'clip-rect-sr-only-rtl'];
// clip-rect-nested's z-index 0 stacking contexts in flow; clip-rect-sr-only's inline box.
export const CLIP_RECT_REASON = /^(stacking context on cut-z0, cut-ctx: hit testing through z-index layers and stacking contexts in the normal flow is not modelled yet|cut-inline-s is an inline box, which the hit table does not model yet)/;
// The clip-path fixture cases: Chrome's elementFromPoint passes over what a clip-path clips away, which the hit table does not model.
export const CLIP_PATH_OUT: readonly string[] = ['clip-path-basic', 'clip-path-basic-rtl', 'clip-path-nested', 'clip-path-nested-rtl', 'clip-path-circle', 'clip-path-circle-rtl', 'clip-path-polygon', 'clip-path-polygon-rtl', 'clip-path-text', 'clip-path-text-rtl'];
export const CLIP_PATH_REASON = /^clip-path on .+: hit testing past what a clip-path clips away is not modelled yet \(MASK-CLIP\)$/;
