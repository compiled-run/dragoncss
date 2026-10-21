// field-sizing; Dragon refuses content on a replaced element.

export type FieldSizingFaults = {
  /** field-sizing: content is accepted on a replaced element, whose sizing no case proves it leaves alone. */
  readonly fieldSizingReplacedAccepted: boolean;
};

export const FIELD_SIZING_FAULTS: FieldSizingFaults = { fieldSizingReplacedAccepted: false };
