// Blockification (css-display-3 §2.7).

export type BlockifyFaults = {
  /** Flex and grid items and absolutely positioned boxes keep their inline-level display (css-display-3 §2.7). */
  readonly blockifySkipped: boolean;
  /** Blockification turns inline-flex into block instead of flex. */
  readonly inlineFlexToBlock: boolean;
};

export const BLOCKIFY_FAULTS: BlockifyFaults = { blockifySkipped: false, inlineFlexToBlock: false };
