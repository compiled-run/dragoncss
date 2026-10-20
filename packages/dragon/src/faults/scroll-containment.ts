// The containment and container-query families, which Dragon accepts at their initial values alone, and scroll snapping, which it
// accepts wherever nothing snaps.

export type ScrollContainmentFaults = {
  /** An active snap pair (a scroll container with a snap type and a snap area) is accepted on iOS and Android, though neither snaps. */
  readonly scrollSnapAccepted: boolean;
  /** A contain, content-visibility or contain-intrinsic longhand other than its initial value is accepted, though no target contains. */
  readonly containmentAccepted: boolean;
  /** A container-type or container-name other than its initial value is accepted, though no target has container queries. */
  readonly containerQueryAccepted: boolean;
};

export const SCROLL_CONTAINMENT_FAULTS: ScrollContainmentFaults = { scrollSnapAccepted: false, containmentAccepted: false, containerQueryAccepted: false };
