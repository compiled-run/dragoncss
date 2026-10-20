// The overscroll, scroll-snap, containment, container-query, anchor-position, svg-extra, view-transition and animation-extra
// families, which Dragon accepts at their initial values alone, and image-rendering: pixelated over an image layer.

export type ScrollContainmentFaults = {
  /** An overscroll-behavior or overflow-anchor longhand other than auto is accepted, though no target implements it. */
  readonly overscrollAccepted: boolean;
  /** A scroll-padding, scroll-margin or scroll-snap longhand other than its initial value is accepted, though no target snaps. */
  readonly scrollSnapAccepted: boolean;
  /** A contain, content-visibility or contain-intrinsic longhand other than its initial value is accepted, though no target contains. */
  readonly containmentAccepted: boolean;
  /** A container-type or container-name other than its initial value is accepted, though no target has container queries. */
  readonly containerQueryAccepted: boolean;
  /** image-rendering: pixelated is accepted on iOS and Android over an image layer they draw smoothly (analysis/image-rendering.ts). */
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

export const SCROLL_CONTAINMENT_FAULTS: ScrollContainmentFaults = { overscrollAccepted: false, scrollSnapAccepted: false, containmentAccepted: false, containerQueryAccepted: false, imageRenderingAccepted: false, anchorPositionAccepted: false, svgExtraAccepted: false, viewTransitionAccepted: false, animationExtraAccepted: false };
