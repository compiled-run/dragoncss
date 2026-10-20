// font-size percentages and <absolute-size> keywords (css-fonts-4 §2.5), computed to px at compile time (analysis/computed.ts).

export type TxtFsFaults = {
  /** An <absolute-size> keyword takes the spec's scaling factors (small = 8/9 of medium) instead of Chrome's table (small = 13px). */
  readonly absoluteSizeSpecTable: boolean;
  /** A font-size percentage is taken of the root's font-size instead of the parent's. */
  readonly fontSizePercentOfRoot: boolean;
  /** An author font-size Chrome clamps to its minimum logical font size (a percentage under a keyword size) is accepted. */
  readonly keywordMinimumUnchecked: boolean;
};

export const TXT_FS_FAULTS: TxtFsFaults = { absoluteSizeSpecTable: false, fontSizePercentOfRoot: false, keywordMinimumUnchecked: false };
