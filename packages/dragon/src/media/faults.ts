// Planted faults local to the media module; the Chrome comparison must catch each one.

export type MediaFaults = {
  /** max-width and max-height compare with < instead of <=. */
  readonly maxWidthExclusive: boolean;
  /** em and rem in a media query resolve against the root font size instead of the initial 16px. */
  readonly emFromRoot: boolean;
  /** A <general-enclosed> evaluates to true instead of unknown. */
  readonly unknownAsTrue: boolean;
  /** `not` binds to its first operand only, so `not (a) and (b)` and `not screen and (a)` parse as a conjunction. */
  readonly notBindsTighterThanAnd: boolean;
  /** The band partition leaves every threshold point out of every band. */
  readonly bandGapAtBoundary: boolean;
};

export const NO_MEDIA_FAULTS: MediaFaults = {
  maxWidthExclusive: false,
  emFromRoot: false,
  unknownAsTrue: false,
  notBindsTighterThanAnd: false,
  bandGapAtBoundary: false,
};

export const MEDIA_FAULT_NAMES: readonly (keyof MediaFaults)[] = Object.keys(NO_MEDIA_FAULTS) as (keyof MediaFaults)[];
