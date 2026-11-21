// contain-intrinsic-width, -height and contain-intrinsic-size on size-contained boxes.

export type ContainIntrinsicFaults = {
  /** The ios lowering writes none for every contain-intrinsic-width and -height, so a size-contained box sizes as if it were empty. */
  readonly intrinsicSizeDropped: boolean;
  /** contain-intrinsic-width or -height: auto is accepted on a box size containment applies to, though Dragon remembers no size. */
  readonly intrinsicAutoAccepted: boolean;
};

export const CONTAIN_INTRINSIC_FAULTS: ContainIntrinsicFaults = { intrinsicSizeDropped: false, intrinsicAutoAccepted: false };
