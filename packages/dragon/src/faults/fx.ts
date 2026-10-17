// FX: filter, backdrop-filter and mix-blend-mode (coverage-rank lane FX); Dragon accepts filter: none alone.

export type FxFaults = {
  /** A filter other than none is accepted, though no target draws filters. */
  readonly filterListAccepted: boolean;
};

export const FX_FAULTS: FxFaults = { filterListAccepted: false };
