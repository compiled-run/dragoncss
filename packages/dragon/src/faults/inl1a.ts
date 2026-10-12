// INL1a: inline formatting contexts.

export type Inl1aFaults = {
  /** The lowering turns a <br> into a text leaf holding one space instead of a line break (INL1a). */
  readonly brAsSpace: boolean;
  /** Each inline-level child beside block-level boxes gets its own anonymous box instead of one per maximal run (CSS2 §9.2.1.1). */
  readonly inlineWrapperPerElement: boolean;
};

export const INL1A_FAULTS: Inl1aFaults = { brAsSpace: false, inlineWrapperPerElement: false };
