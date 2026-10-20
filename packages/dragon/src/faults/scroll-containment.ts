// The overscroll, scroll-snap, containment and container-query families; Dragon accepts the first three at their initial values
// alone, and container-type at normal and inline-size.

export type ScrollContainmentFaults = {
  /** An overscroll-behavior or overflow-anchor longhand other than auto is accepted, though no target implements it. */
  readonly overscrollAccepted: boolean;
  /** A scroll-padding, scroll-margin or scroll-snap longhand other than its initial value is accepted, though no target snaps. */
  readonly scrollSnapAccepted: boolean;
  /** A contain, content-visibility or contain-intrinsic longhand other than its initial value is accepted, though no target contains. */
  readonly containmentAccepted: boolean;
  /** Every container-type is accepted, though no target has size containment or scroll-state and anchored queries. */
  readonly containerQueryAccepted: boolean;
  /** CQ: a @container query reads its container's width as the viewport's, without the margins and padding on the way. */
  readonly containerShiftDropped: boolean;
  /** CQ: an element that is a query container answers its own @container rules, as only its pseudo-elements may. */
  readonly containerSelfQueried: boolean;
  /** CQ: a cqw or cqi length reads its container's width as the viewport less the shift, without its min-width and max-width clamp. */
  readonly containerUnitUnclamped: boolean;
};

export const SCROLL_CONTAINMENT_FAULTS: ScrollContainmentFaults = { overscrollAccepted: false, scrollSnapAccepted: false, containmentAccepted: false, containerQueryAccepted: false, containerShiftDropped: false, containerSelfQueried: false, containerUnitUnclamped: false };
