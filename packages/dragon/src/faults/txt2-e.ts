// TXT2-e: text-transform at build time (analysis/text-transform.ts).

export type Txt2eFaults = {
  /** lowercase maps U+03A3 to σ everywhere, ignoring Final_Sigma (Unicode 16 §3.13). */
  readonly finalSigmaIgnored: boolean;
  /** uppercase and lowercase use only the simple mappings, dropping SpecialCasing's full ones (ß stays ß). */
  readonly specialCasingDropped: boolean;
  /** capitalize ends a word at an apostrophe, so can't becomes Can'T. */
  readonly capitalizeAfterApostrophe: boolean;
  /** capitalize starts every text node as if a space came before it, dropping the previous character of the formatting context. */
  readonly capitalizePrevCharReset: boolean;
};

export const TXT2_E_FAULTS: Txt2eFaults = { finalSigmaIgnored: false, specialCasingDropped: false, capitalizeAfterApostrophe: false, capitalizePrevCharReset: false };
