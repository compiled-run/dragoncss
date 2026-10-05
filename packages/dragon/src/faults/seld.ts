// SELD-R1a: the state program and its setters.

export type SeldFaults = {
  /** The state program loses the last changed node record of every assignment's delta (SELD-R1a, lower/state-program.ts). */
  readonly stateDeltaDropped: boolean;
  /** The generated state setters never lay out again, even when the engine input changes (SELD-R1a). */
  readonly setterSkipsRelayout: boolean;
};

export const SELD_FAULTS: SeldFaults = { stateDeltaDropped: false, setterSkipsRelayout: false };
