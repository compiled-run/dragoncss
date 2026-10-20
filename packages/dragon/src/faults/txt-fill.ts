// TXT-FX: the text fill colour and stroke (computed-checks.ts checkTextFillStroke, native-program.ts textPaint).

export type TxtFillFaults = {
  /** Native fills glyphs in color, ignoring a -webkit-text-fill-color other than currentcolor. */
  readonly textFillIgnored: boolean;
  /** A stroke wider than 0 is accepted, though no stroke is drawn. */
  readonly textStrokeAccepted: boolean;
};

export const TXT_FILL_FAULTS: TxtFillFaults = { textFillIgnored: false, textStrokeAccepted: false };
