// TXT-FONTFEAT: font-kerning, font-optical-sizing and font-language-override, off their initial value only over Ahem text
// (analysis/font-tuning.ts).

export type TxtFtFaults = {
  /** A non-initial font-kerning, font-optical-sizing or font-language-override is accepted over text in a real face too. */
  readonly fontTuningOnRealFaceAccepted: boolean;
};

export const TXT_FT_FAULTS: TxtFtFaults = { fontTuningOnRealFaceAccepted: false };
