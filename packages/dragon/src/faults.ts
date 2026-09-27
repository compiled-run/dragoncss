// Internal fault switches, reachable only through createProjectWith, so the parity harness can prove it fails (docs/api.md §7).

export type CompilerFaults = {
  /** The ios lowering swaps content-box and border-box. */
  readonly swapBoxSizing: boolean;
  /** The resolver ignores the last class of every compound selector with two or more classes, collapsing variants. */
  readonly variantCollapse: boolean;
  /** The resolver moves every resolved colour's red channel by one step and changes nothing else. */
  readonly colourOnly: boolean;
  /** The resolver ignores the state on this element address: its classes and attributes keep their initial-assignment values. */
  readonly stateCollapse: string | null;
};

export const NO_FAULTS: CompilerFaults = { swapBoxSizing: false, variantCollapse: false, colourOnly: false, stateCollapse: null };
