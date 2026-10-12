// CASC: cascade breadth (@supports, revert and revert-layer).

export type CascFaults = {
  /** Every @supports block applies, as a compiler that kept the rules without evaluating the condition would (css/stylesheet.ts). */
  readonly supportsConditionIgnored: boolean;
  /** revert and revert-layer act as unset, as a resolver that skipped the roll-back to the user-agent origin would (analysis/resolve.ts). */
  readonly revertAsUnset: boolean;
};

export const CASC_FAULTS: CascFaults = { supportsConditionIgnored: false, revertAsUnset: false };
