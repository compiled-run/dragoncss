// TXT2-d and TXT-BREAK-2: word-break break-all and keep-all (notes/T149-txt2-spec.md R15).

export type Txt2dFaults = {
  /** word-break: break-all is accepted over text that holds a character outside the Latin set, or U+00AD. */
  readonly breakAllOutsideSetAccepted: boolean;
};

export const TXT2_D_FAULTS: Txt2dFaults = { breakAllOutsideSetAccepted: false };
