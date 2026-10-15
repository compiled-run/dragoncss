// TXT-W: font-weight and font-style over Ahem, whose one regular face Chrome draws synthesized from weight 600 and slope 14deg.

export type TxtWFaults = {
  /** Native accepts Ahem text at a computed font-weight of 600 to 699, which Chrome draws in synthetic bold. */
  readonly ahemSyntheticBoldFrom700: boolean;
};

export const TXT_W_FAULTS: TxtWFaults = { ahemSyntheticBoldFrom700: false };
