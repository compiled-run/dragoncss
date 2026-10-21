// The containment family, which Dragon accepts at its initial values alone, the container-query family (container-type at
// inline-size too), scroll snapping, which it accepts wherever nothing snaps, and the image-rendering,
// anchor-position, svg-extra, view-transition and animation-extra families, which it accepts at their initial values alone.

export type ScrollContainmentFaults = {
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
  /** CQ: a cqw or cqi length reads its container's width as the viewport less the shift, without its min-width and max-width clamp. */
  readonly containerUnitUnclamped: boolean;
  /** An image-rendering other than auto is accepted, though no target draws an image other than smoothly. */
  readonly imageRenderingAccepted: boolean;
  /** An anchor positioning longhand other than its initial value is accepted, though no target anchors a box. */
  readonly anchorPositionAccepted: boolean;
  /** An svg-extra longhand other than its initial value is accepted, though no target draws what it changes. */
  readonly svgExtraAccepted: boolean;
  /** A view-transition longhand other than its initial value is accepted, though no target runs view transitions. */
  readonly viewTransitionAccepted: boolean;
  /** An interpolate-size or timeline-scope other than its initial value is accepted, though no target implements it. */
  readonly animationExtraAccepted: boolean;
};

export const SCROLL_CONTAINMENT_FAULTS: ScrollContainmentFaults = { scrollSnapAccepted: false, containmentAccepted: false, containerQueryAccepted: false, containerShiftDropped: false, containerSelfQueried: false, containerUnitUnclamped: false, imageRenderingAccepted: false, anchorPositionAccepted: false, svgExtraAccepted: false, viewTransitionAccepted: false, animationExtraAccepted: false };
