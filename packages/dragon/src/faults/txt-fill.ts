// TXT-FX: the text fill colour and stroke, accepted where they draw what Chrome draws without them (computed-checks.ts checkTextFillStroke).

export type TxtFillFaults = {
  /** A fill colour other than currentcolor is accepted, though glyphs are painted in color. */
  readonly textFillColorAccepted: boolean;
  /** A stroke wider than 0 is accepted, though no stroke is drawn. */
  readonly textStrokeAccepted: boolean;
};

export const TXT_FILL_FAULTS: TxtFillFaults = { textFillColorAccepted: false, textStrokeAccepted: false };
