// TXT-FX: the text fill colour (native-program.ts textPaint) and the stroke (analysis/text-stroke.ts, native-program.ts text-stroke).

export type TxtFillFaults = {
  /** Native fills glyphs in color, ignoring a -webkit-text-fill-color other than currentcolor. */
  readonly textFillIgnored: boolean;
  /** Every stroke is accepted on every target, and none is drawn natively (analysis/text-stroke.ts, native-program.ts text-stroke). */
  readonly textStrokeAccepted: boolean;
};

export const TXT_FILL_FAULTS: TxtFillFaults = { textFillIgnored: false, textStrokeAccepted: false };
