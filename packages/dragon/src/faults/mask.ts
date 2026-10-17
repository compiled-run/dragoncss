// MASK-CLIP: the mask layer longhands (coverage-rank lane MASK-CLIP); Dragon accepts each at its initial value alone.

export type MaskFaults = {
  /** A mask longhand other than its initial value is accepted, though no target draws masks. */
  readonly maskLayerAccepted: boolean;
};

export const MASK_FAULTS: MaskFaults = { maskLayerAccepted: false };
