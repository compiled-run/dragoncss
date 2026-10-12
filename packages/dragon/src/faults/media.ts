// MQ-a: @media bands.

export type MediaFaults = {
  /** MQ-a: every rule inside @media applies in every band, whatever its condition. */
  readonly mediaConditionIgnored: boolean;
  /** MQ-a: the native output takes the band holding the fold viewport one CSS px wider than it is. */
  readonly mediaBandOffByOne: boolean;
};

export const MEDIA_FAULTS: MediaFaults = { mediaConditionIgnored: false, mediaBandOffByOne: false };
