// INL2a: atomic inlines.

export type Inl2aFaults = {
  /** An atomic inline ends its inline formatting context's white-space collapsing, so 'aa <ib> bb' loses both spaces (INL2a, resolve.ts). */
  readonly atomicCollapsesAsLineEnd: boolean;
};

export const INL2A_FAULTS: Inl2aFaults = { atomicCollapsesAsLineEnd: false };
