// TXT-FONTFEAT: the font-variant feature longhands, accepted over Ahem text alone (analysis/font-variant.ts), and small caps
// synthesized over Ahem (analysis/computed.ts synthesizesSmallCaps).

export type TxtFvFaults = {
  /** A non-normal font-variant feature longhand is accepted over text in a real face too, whose features Dragon does not apply. */
  readonly fontVariantOnRealFaceAccepted: boolean;
  /** font-variant-caps: small-caps reaches the engine as normal: lowercase letters are laid out and drawn at the full size. */
  readonly smallCapsUnsynthesized: boolean;
};

export const TXT_FV_FAULTS: TxtFvFaults = { fontVariantOnRealFaceAccepted: false, smallCapsUnsynthesized: false };
