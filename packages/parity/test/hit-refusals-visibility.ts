// The hit lane leaves out, by name, the visibility fixture cases (hit-capture.ts hitRefusal): Chrome's elementFromPoint passes over a
// box that is not visible, which the hit table does not model yet (T150b). Shared by hit-report.test.ts and lanes.test.ts.
export const VISIBILITY_OUT: readonly string[] = ['visibility-basic', 'visibility-basic-rtl', 'visibility-paint', 'visibility-paint-rtl', 'visibility-flex', 'visibility-flex-rtl', 'visibility-text', 'visibility-text-rtl', 'visibility-root', 'visibility-root-rtl'];
export const VISIBILITY_REASON = /^visibility on .+: hit testing past a box that is not visible is not modelled yet \(T150b\)$/;
