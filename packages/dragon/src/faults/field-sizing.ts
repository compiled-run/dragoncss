// field-sizing; Dragon refuses content on a replaced element or a form control.

export type FieldSizingFaults = {
  /** field-sizing: content is accepted on a replaced element or a form control, whose sizing no case proves it leaves alone. */
  readonly fieldSizingReplacedAccepted: boolean;
};

export const FIELD_SIZING_FAULTS: FieldSizingFaults = { fieldSizingReplacedAccepted: false };
