// The multicol family (analysis/multicol.ts).

export type MulticolFaults = {
  /** A multi-column container the engine does not lay out, a column-width or column-count it does not read, and a column rule, column-span or column-fill other than its initial value are accepted. */
  readonly multicolAccepted: boolean;
};

export const MULTICOL_FAULTS: MulticolFaults = { multicolAccepted: false };
