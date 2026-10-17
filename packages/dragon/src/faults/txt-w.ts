// TXT-W: font-weight and font-style over Ahem, whose one regular face Chrome draws synthesized from weight 600 and slope 14deg.

export type TxtWFaults = {
  /** Native draws Ahem text at a computed font-weight of 600 to 699, which Chrome draws in synthetic bold, unemboldened. */
  readonly ahemSyntheticBoldFrom700: boolean;
  /** Native draws Ahem text Chrome draws in synthetic bold unemboldened: the native program gets no synthetic-bold write. */
  readonly ahemBoldUnstroked: boolean;
};

export const TXT_W_FAULTS: TxtWFaults = { ahemSyntheticBoldFrom700: false, ahemBoldUnstroked: false };
