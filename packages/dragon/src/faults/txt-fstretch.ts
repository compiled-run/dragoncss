// TXT-FONTFEAT: font-stretch, accepted at every width over Ahem text alone (computed-checks.ts checkFontStretch).

export type TxtFstretchFaults = {
  /** A width other than 100% is accepted over text in a real face too, whose family Dragon does not match by width. */
  readonly fontStretchOnRealFaceAccepted: boolean;
};

export const TXT_FSTRETCH_FAULTS: TxtFstretchFaults = { fontStretchOnRealFaceAccepted: false };
