// The hit lane leaves out, by name, the clip fixture cases (hit-capture.ts hitRefusal): Chrome's elementFromPoint passes over a box
// its empty clip rect hides, and over its descendants, which the hit table does not model yet (MASK-CLIP). Shared by
// hit-report.test.ts and lanes.test.ts.
export const CLIP_RECT_OUT: readonly string[] = ['clip-rect-basic', 'clip-rect-basic-rtl', 'clip-rect-nested', 'clip-rect-nested-rtl'];
export const CLIP_RECT_REASON = /^clip on .+: hit testing past a box its clip rect hides is not modelled yet \(MASK-CLIP\)$/;
// The clip-path fixture cases: Chrome's elementFromPoint passes over what a clip-path clips away, which the hit table does not model.
export const CLIP_PATH_OUT: readonly string[] = ['clip-path-basic', 'clip-path-basic-rtl', 'clip-path-nested', 'clip-path-nested-rtl'];
export const CLIP_PATH_REASON = /^clip-path on .+: hit testing past what a clip-path clips away is not modelled yet \(MASK-CLIP\)$/;
