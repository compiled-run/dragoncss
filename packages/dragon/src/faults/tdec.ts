// TDEC: text decorations.

export type TdecFaults = {
  /** Text decorations propagate into absolutely positioned descendants too (css-text-decor-3 §2.1 says they do not; TDEC-a). */
  readonly propagatedIntoOutOfFlow: boolean;
};

export const TDEC_FAULTS: TdecFaults = { propagatedIntoOutOfFlow: false };
