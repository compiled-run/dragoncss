// MISC-PAINT: the border image longhands (coverage-rank lane MISC-PAINT); Dragon accepts each at its initial value alone.

export type BorderImageFaults = {
  /** A border image longhand other than its initial value is accepted, though no target draws border images. */
  readonly borderImageAccepted: boolean;
};

export const BORDER_IMAGE_FAULTS: BorderImageFaults = { borderImageAccepted: false };
