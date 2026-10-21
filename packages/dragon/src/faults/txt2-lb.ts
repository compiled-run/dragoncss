// TXT2-lb: line-break strictness levels (css-text-3 §5.3).

export type Txt2lbFaults = {
  /** line-break loose, normal or strict is accepted over text that holds a character the text-line-break fixtures do not cover. */
  readonly lineBreakOutsideAsciiAccepted: boolean;
  /** line-break loose, normal or strict is accepted over text drawn in a real face. */
  readonly lineBreakOnRealFaceAccepted: boolean;
};

export const TXT2_LB_FAULTS: Txt2lbFaults = { lineBreakOutsideAsciiAccepted: false, lineBreakOnRealFaceAccepted: false };
