// TXT2-c: white-space preserve modes (notes/T149-txt2-spec.md R3).

export type Txt2cFaults = {
  /** pre-line keeps the collapsible space before a preserved newline instead of removing it (Blink AppendForcedBreakCollapseWhitespace). */
  readonly preLineKeepsSpaceBeforeNewline: boolean;
};

export const TXT2_C_FAULTS: Txt2cFaults = { preLineKeepsSpaceBeforeNewline: false };
