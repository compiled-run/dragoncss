// OVFL: scroll containers and viewport propagation.

export type OvflFaults = {
  /** Viewport propagation takes body's overflow even when html's is not visible, so html keeps its own (css-overflow-3 §3.3). */
  readonly propagationFromBody: boolean;
};

export const OVFL_FAULTS: OvflFaults = { propagationFromBody: false };
