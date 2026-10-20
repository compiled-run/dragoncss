// TXT2-b (notes/T149-txt2-spec.md): letter-spacing and word-spacing.
export type Txt2bFaults = {
  /** letter-spacing: 0 keeps the zero length instead of computing to normal (longhands_custom.cc LetterSpacing). */
  readonly zeroNotNormal: boolean;
  /** word-spacing: normal stays normal instead of computing to 0px (longhands_custom.cc WordSpacing). */
  readonly wordNormalNotZero: boolean;
};

export const TXT2B_FAULTS: Txt2bFaults = { zeroNotNormal: false, wordNormalNotZero: false };
