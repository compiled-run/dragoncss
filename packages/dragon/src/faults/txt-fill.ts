// TXT-FX: the text fill colour, accepted where it draws what Chrome draws without it (computed-checks.ts checkTextFillStroke), and the stroke.

export type TxtFillFaults = {
  /** A fill colour other than currentcolor is accepted, though glyphs are painted in color. */
  readonly textFillColorAccepted: boolean;
  /** Every stroke is accepted on every target, and none is drawn natively (analysis/text-stroke.ts, native-program.ts text-stroke). */
  readonly textStrokeAccepted: boolean;
};

export const TXT_FILL_FAULTS: TxtFillFaults = { textFillColorAccepted: false, textStrokeAccepted: false };
