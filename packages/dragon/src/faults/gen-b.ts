// GEN-b: content and list-style longhands, and list items whose marker generates no box (notes/T151-gen-spec.md R13).

export type GenBFaults = {
  /** A list item whose list-style-type and list-style-image are none is refused as if it had a marker. */
  readonly listItemNoneMarkerRefused: boolean;
  /** A list item with a marker (list-style-type disc, the UA default) is accepted and laid out as a block. */
  readonly listItemDiscAccepted: boolean;
  /** content: none on an element keeps none, where it computes to normal (css-content-3 §2). */
  readonly contentNoneOnElementKept: boolean;
  /** The list-style shorthand's none sets only list-style-image, so list-style-type keeps its initial disc. */
  readonly listStyleNoneSetsImageOnly: boolean;
};

export const GEN_B_FAULTS: GenBFaults = { listItemNoneMarkerRefused: false, listItemDiscAccepted: false, contentNoneOnElementKept: false, listStyleNoneSetsImageOnly: false };
