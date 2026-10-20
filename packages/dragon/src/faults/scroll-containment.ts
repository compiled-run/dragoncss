// The overscroll, scroll-snap, containment and container-query families; Dragon accepts their initial values alone.

export type ScrollContainmentFaults = {
  /** An overscroll-behavior or overflow-anchor longhand other than auto is accepted, though no target implements it. */
  readonly overscrollAccepted: boolean;
  /** A scroll-padding, scroll-margin or scroll-snap longhand other than its initial value is accepted, though no target snaps. */
  readonly scrollSnapAccepted: boolean;
  /** A contain, content-visibility or contain-intrinsic longhand other than its initial value is accepted, though no target contains. */
  readonly containmentAccepted: boolean;
  /** A container-type or container-name other than its initial value is accepted, though no target has container queries. */
  readonly containerQueryAccepted: boolean;
};

export const SCROLL_CONTAINMENT_FAULTS: ScrollContainmentFaults = { overscrollAccepted: false, scrollSnapAccepted: false, containmentAccepted: false, containerQueryAccepted: false };
