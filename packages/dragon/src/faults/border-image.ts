// MISC-PAINT: the border image longhands (coverage-rank lane MISC-PAINT); Dragon accepts each at its initial value alone.

export type BorderImageFaults = {
  /** A border image longhand other than its initial value is accepted, though no target draws border images. */
  readonly borderImageAccepted: boolean;
  /** A tiled border image (repeat, round or space) is accepted natively without the proof that its tiles are whole device px. */
  readonly borderImageTilingUnchecked: boolean;
};

export const BORDER_IMAGE_FAULTS: BorderImageFaults = { borderImageAccepted: false, borderImageTilingUnchecked: false };
