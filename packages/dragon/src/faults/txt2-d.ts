// TXT2-d: word-break break-all and keep-all (notes/T149-txt2-spec.md R15).

export type Txt2dFaults = {
  /** word-break: break-all is accepted over text that holds a character other than an ASCII letter, digit or white space. */
  readonly breakAllOutsideAsciiAccepted: boolean;
  /** word-break break-all and keep-all are accepted over text drawn in a real face. */
  readonly wordBreakOnRealFaceAccepted: boolean;
};

export const TXT2_D_FAULTS: Txt2dFaults = { breakAllOutsideAsciiAccepted: false, wordBreakOnRealFaceAccepted: false };
