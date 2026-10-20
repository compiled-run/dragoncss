// The multicol family; Dragon accepts its initial values alone.

export type MulticolFaults = {
  /** A column-width, column-count, column rule, column-span or column-fill other than its initial value is accepted, though no target builds columns. */
  readonly multicolAccepted: boolean;
};

export const MULTICOL_FAULTS: MulticolFaults = { multicolAccepted: false };
