// GEN-c: outside list markers (notes/T151-gen-spec.md R14). The compiler plants of the ordinal and counter-style ports.

export type GenCFaults = {
  /** An li's value attribute is ignored, so it takes the previous item's value plus one (list_item_ordinal.cc CalcValue). */
  readonly ordinalIgnoresValue: boolean;
  /** A reversed ol counts up from its start, as an ordinary ol does. */
  readonly reversedCountsUp: boolean;
  /** lower-roman and upper-roman write values outside 1-3999 additively instead of falling back to decimal. */
  readonly romanNoFallback: boolean;
  /** decimal-leading-zero is not padded to 2. */
  readonly leadingZeroUnpadded: boolean;
};

export const GEN_C_FAULTS: GenCFaults = { ordinalIgnoresValue: false, reversedCountsUp: false, romanNoFallback: false, leadingZeroUnpadded: false };
