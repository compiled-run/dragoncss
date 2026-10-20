// PNT2: the 3D transform longhands (backface-visibility, transform-style, transform-box); Dragon accepts their initial values alone.

export type TransformExtraFaults = {
  /** A 3D transform longhand other than its initial value is accepted, though no target draws it. */
  readonly transformExtraAccepted: boolean;
};

export const TRANSFORM_EXTRA_FAULTS: TransformExtraFaults = { transformExtraAccepted: false };
