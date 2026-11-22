// SEL-dir: the directionality :dir() matches.

export type SelDirFaults = {
  /** :dir() reads only the element's own dir attribute, so an element inherits no directionality from its ancestors (HTML §3.2.6.4). */
  readonly dirNotInherited: boolean;
  /** dir compares its ltr and rtl keywords case-sensitively, so dir=RTL sets no directionality (HTML §2.3.3). */
  readonly dirCaseSensitive: boolean;
};

export const SEL_DIR_FAULTS: SelDirFaults = { dirNotInherited: false, dirCaseSensitive: false };
