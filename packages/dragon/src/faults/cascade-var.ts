// The cascade with var(): direction and flow-relative declarations.

export type CascadeVarFaults = {
  /** The cascade resolves direction before var() substitution: a direction declaration holding var() is skipped. */
  readonly directionBeforeVar: boolean;
  /** A flow-relative declaration holding var() is not narrowed to the element's direction: it competes on both physical sides. */
  readonly varLogicalBothSides: boolean;
};

export const CASCADE_VAR_FAULTS: CascadeVarFaults = { directionBeforeVar: false, varLogicalBothSides: false };
