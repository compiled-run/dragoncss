// The hit lane leaves out, by name, the FORM-a range fixture cases (rt-hit.ts hitRefusal): a range's touch is consumed by the
// slider (T064 P7), which the hit table does not model yet. Shared by hit-report.test.ts and lanes.test.ts.
export const CONTROLS_OUT: readonly string[] = ['controls-range-block', 'controls-range-block-rtl', 'controls-range-flex', 'controls-range-flex-rtl'];
export const CONTROLS_REASON = /^(?:hit test: )?\S+ is a form control, which the hit table does not model yet \(FORM-a; Chrome retargets its parts to the control, no Chrome hit capture\)$/;
