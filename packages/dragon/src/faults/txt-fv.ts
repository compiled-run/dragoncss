// TXT-FONTFEAT: the font-variant feature longhands, accepted over Ahem text alone (analysis/font-variant.ts).

export type TxtFvFaults = {
  /** A non-normal font-variant feature longhand is accepted over text in a real face too, whose features Dragon does not apply. */
  readonly fontVariantOnRealFaceAccepted: boolean;
};

export const TXT_FV_FAULTS: TxtFvFaults = { fontVariantOnRealFaceAccepted: false };
