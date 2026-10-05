// V1: calculation lowering.

export type ValuesFaults = {
  /** The ios lowering reverses the terms of every calculation sum, so float sums accumulate in the wrong order (css/math.ts). */
  readonly sumOrderSwapped: boolean;
  /** The ios lowering drops explicit 0% terms of calculations, so a calculation with only a 0% percentage loses its percentage. */
  readonly dropExplicitZeroPercent: boolean;
};

export const VALUES_FAULTS: ValuesFaults = { sumOrderSwapped: false, dropExplicitZeroPercent: false };
