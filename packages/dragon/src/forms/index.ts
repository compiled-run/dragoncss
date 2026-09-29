// Forms reference data and functions (FORM-0): the range value model, the thumb offset, the button content model and the
// devolve rule, each compared with Chrome 145 by scripts/capture-form-data.ts --check. FORM-a moves the functions into the engine.
export { Decimal } from './decimal.ts';
export { clampValue, defaultValue, parseNumber, rangeRatio, rangeValue, stepRange } from './range-value.ts';
export type { RangeAttributes, StepRange } from './range-value.ts';
export { divLU, LU_PER_PX, layoutUnitFromPx, thumbLeft, thumbOffset, truncate } from './range-geometry.ts';
export { buttonContentModel, buttonContentShift } from './button-inner.ts';
export type { ButtonContentModel } from './button-inner.ts';
export { usedAppearance } from './appearance.ts';
export type { AuthorControlStyle, Control, UsedAppearance } from './appearance.ts';
export { FORM_FAULT_NAMES, FORM_PLANTS, NO_FORM_FAULTS } from './faults.ts';
export type { FormFaults } from './faults.ts';
export { authorStyleOf, compareForms, expectedButtonChildren } from './compare.ts';
export type * from './compare.ts';
