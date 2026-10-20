// The overscroll, containment and container-query families, which Dragon accepts at their initial values alone (and container-type
// at inline-size too), and scroll snapping, which it accepts wherever nothing snaps.

export type ScrollContainmentFaults = {
  /** An overscroll-behavior or overflow-anchor longhand other than auto is accepted, though no target implements it. */
  readonly overscrollAccepted: boolean;
  /** An active snap pair (a scroll container with a snap type and a snap area) is accepted on iOS and Android, though neither snaps. */
  readonly scrollSnapAccepted: boolean;
  /** A contain, content-visibility or contain-intrinsic longhand other than its initial value is accepted, though no target contains. */
  readonly containmentAccepted: boolean;
  /** Every container-type is accepted, though no target has size containment or scroll-state and anchored queries. */
  readonly containerQueryAccepted: boolean;
  /** CQ: a @container query reads its container's width as the viewport's, without the margins and padding on the way. */
  readonly containerShiftDropped: boolean;
  /** CQ: an element that is a query container answers its own @container rules, as only its pseudo-elements may. */
  readonly containerSelfQueried: boolean;
};

export const SCROLL_CONTAINMENT_FAULTS: ScrollContainmentFaults = { overscrollAccepted: false, scrollSnapAccepted: false, containmentAccepted: false, containerQueryAccepted: false, containerShiftDropped: false, containerSelfQueried: false };
