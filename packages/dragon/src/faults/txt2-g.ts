// TXT2-g: the legacy line clamp (analysis/line-clamp.ts).

export type Txt2GFaults = {
  /** The web output writes a line-clamp container's computed display: flow-root instead of the authored -webkit-box, which drops the clamp in Chrome. */
  readonly webkitBoxEmittedAsFlowRoot: boolean;
};

export const TXT2_G_FAULTS: Txt2GFaults = { webkitBoxEmittedAsFlowRoot: false };
