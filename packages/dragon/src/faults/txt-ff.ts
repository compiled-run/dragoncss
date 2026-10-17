// TXT-FONTFEAT: font-feature-settings and font-variation-settings, accepted over Ahem text alone (computed-checks.ts checkFontFeatures).

export type TxtFfFaults = {
  /** A non-normal setting is accepted over text in a real face too, whose features and axes Dragon does not apply. */
  readonly fontFeaturesOnRealFaceAccepted: boolean;
};

export const TXT_FF_FAULTS: TxtFfFaults = { fontFeaturesOnRealFaceAccepted: false };
