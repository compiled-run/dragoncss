// The hit lane leaves out, by name, the FORM-a controls fixture cases (rt-hit.ts hitRefusal): Chrome retargets a hit on a control's
// UA shadow parts to the control element, which the hit table does not model yet. Shared by hit-report.test.ts and lanes.test.ts.
export const CONTROLS_OUT: readonly string[] = [
  'controls-button-block', 'controls-button-block-rtl', 'controls-button-flex', 'controls-button-flex-rtl', 'controls-button-demo',
  'controls-button-demo-rtl', 'controls-button-type', 'controls-button-type-rtl', 'controls-appearance-display', 'controls-appearance-display-rtl',
];
export const CONTROLS_REASON = /^(?:hit test: )?\S+ is a form control, which the hit table does not model yet \(FORM-a; Chrome retargets its parts to the control, no Chrome hit capture\)$/;
